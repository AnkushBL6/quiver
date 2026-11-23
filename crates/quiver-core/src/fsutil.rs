//! Filesystem helpers. Destructive operations go to the macOS Trash so every
//! change Quiver makes to user data is recoverable.

use anyhow::{Context, Result, bail};
use std::path::{Component, Path, PathBuf};

/// What sits at a path, without following symlinks.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Entry {
    Missing,
    /// Symlink with raw target and whether the target resolves.
    Link {
        target: PathBuf,
        resolves: bool,
    },
    Dir,
    File,
}

pub fn entry(path: &Path) -> Entry {
    match std::fs::symlink_metadata(path) {
        Err(_) => Entry::Missing,
        Ok(m) if m.file_type().is_symlink() => {
            let target = std::fs::read_link(path).unwrap_or_default();
            Entry::Link {
                resolves: path.exists(),
                target,
            }
        }
        Ok(m) if m.is_dir() => Entry::Dir,
        Ok(_) => Entry::File,
    }
}

/// Absolute target of a symlink (relative targets resolved against the link's dir).
pub fn link_target_abs(link: &Path, target: &Path) -> PathBuf {
    if target.is_absolute() {
        lexical_normalize(target)
    } else {
        lexical_normalize(&link.parent().unwrap_or(Path::new("/")).join(target))
    }
}

pub fn lexical_normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for c in path.components() {
        match c {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// Relative path from directory `from` to `to` (both absolute).
pub fn relative(from: &Path, to: &Path) -> PathBuf {
    let f: Vec<_> = from.components().collect();
    let t: Vec<_> = to.components().collect();
    let common = f.iter().zip(&t).take_while(|(a, b)| a == b).count();
    let mut out = PathBuf::new();
    for _ in common..f.len() {
        out.push("..");
    }
    for c in &t[common..] {
        out.push(c.as_os_str());
    }
    out
}

/// Create `link` → `target` as a relative symlink computed from real paths.
pub fn symlink_dir(target: &Path, link: &Path) -> Result<()> {
    let parent = link.parent().context("link has no parent")?;
    std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    let parent_real = std::fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    let target_real = match (target.parent(), target.file_name()) {
        (Some(tp), Some(name)) => std::fs::canonicalize(tp)
            .unwrap_or_else(|_| tp.to_path_buf())
            .join(name),
        _ => target.to_path_buf(),
    };
    let rel = relative(&parent_real, &target_real);
    #[cfg(unix)]
    std::os::unix::fs::symlink(&rel, link)
        .with_context(|| format!("linking {} -> {}", link.display(), rel.display()))?;
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(&target_real, link)
        .with_context(|| format!("linking {}", link.display()))?;
    Ok(())
}

/// Remove a symlink (never its target).
pub fn remove_link(path: &Path) -> Result<()> {
    match entry(path) {
        Entry::Link { .. } => {
            std::fs::remove_file(path).with_context(|| format!("removing link {}", path.display()))
        }
        Entry::Missing => Ok(()),
        _ => bail!("{} is not a symlink", path.display()),
    }
}

/// Move a file or directory to the Trash; falls back to a Quiver-managed
/// backup folder when no Trash is available (headless/CI).
pub fn trash(path: &Path, backup_root: &Path) -> Result<()> {
    if matches!(entry(path), Entry::Missing) {
        return Ok(());
    }
    if matches!(entry(path), Entry::Link { .. }) {
        return remove_link(path);
    }
    if std::env::var_os("QUIVER_NO_TRASH").is_none() && trash::delete(path).is_ok() {
        return Ok(());
    }
    let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%.3f");
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| "item".into());
    let dest = backup_root.join(format!("{stamp}-{name}"));
    std::fs::create_dir_all(backup_root)?;
    move_path(path, &dest)
}

/// Rename, falling back to copy + delete across filesystems.
pub fn move_path(from: &Path, to: &Path) -> Result<()> {
    if let Some(p) = to.parent() {
        std::fs::create_dir_all(p)?;
    }
    if std::fs::rename(from, to).is_ok() {
        return Ok(());
    }
    copy_dir(from, to)?;
    std::fs::remove_dir_all(from).with_context(|| format!("removing {}", from.display()))
}

/// Recursively copy a directory. Internal symlinks are recreated as-is;
/// `.git` and `node_modules` are skipped.
pub fn copy_dir(from: &Path, to: &Path) -> Result<()> {
    std::fs::create_dir_all(to).with_context(|| format!("creating {}", to.display()))?;
    for e in walkdir::WalkDir::new(from)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| {
            let n = e.file_name().to_string_lossy();
            !(e.file_type().is_dir() && (n == ".git" || n == "node_modules"))
        })
    {
        let e = e?;
        let rel = e.path().strip_prefix(from)?;
        let dest = to.join(rel);
        let ft = e.file_type();
        if ft.is_dir() {
            std::fs::create_dir_all(&dest)?;
        } else if ft.is_symlink() {
            let t = std::fs::read_link(e.path())?;
            #[cfg(unix)]
            std::os::unix::fs::symlink(t, &dest)?;
            #[cfg(windows)]
            let _ = t;
        } else {
            std::fs::copy(e.path(), &dest)
                .with_context(|| format!("copying {}", e.path().display()))?;
        }
    }
    Ok(())
}

/// Write a file atomically (temp file + rename in the same directory).
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let dir = path.parent().context("path has no parent")?;
    std::fs::create_dir_all(dir)?;
    let mut tmp = tempfile::NamedTempFile::new_in(dir)?;
    std::io::Write::write_all(&mut tmp, bytes)?;
    // Temp files are created 0600; keep the existing file's mode, else use 0644.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(path)
            .map(|m| m.permissions().mode() & 0o7777)
            .unwrap_or(0o644);
        tmp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(mode))?;
    }
    tmp.persist(path)
        .map_err(|e| e.error)
        .with_context(|| format!("writing {}", path.display()))?;
    Ok(())
}

/// Reject paths that could escape a root (absolute or containing `..`).
pub fn safe_rel(rel: &str) -> Result<PathBuf> {
    let p = Path::new(rel);
    if p.is_absolute()
        || p.components().any(|c| {
            matches!(
                c,
                Component::ParentDir | Component::Prefix(_) | Component::RootDir
            )
        })
    {
        bail!("unsafe path in source: {rel}");
    }
    Ok(p.to_path_buf())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn relative_paths() {
        assert_eq!(
            relative(
                Path::new("/h/.claude/skills"),
                Path::new("/h/.agents/skills/x")
            ),
            PathBuf::from("../../.agents/skills/x")
        );
        assert_eq!(
            relative(Path::new("/a/b"), Path::new("/a/b/c")),
            PathBuf::from("c")
        );
    }

    #[test]
    fn symlink_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("store/x");
        std::fs::create_dir_all(&target).unwrap();
        let link = d.path().join("agent/skills/x");
        symlink_dir(&target, &link).unwrap();
        assert!(matches!(entry(&link), Entry::Link { resolves: true, .. }));
        if let Entry::Link { target: t, .. } = entry(&link) {
            assert!(t.is_relative());
            assert_eq!(
                std::fs::canonicalize(link_target_abs(&link, &t)).unwrap(),
                std::fs::canonicalize(&target).unwrap()
            );
        }
        remove_link(&link).unwrap();
        assert!(target.exists());
    }

    #[cfg(unix)]
    #[test]
    fn atomic_writes_are_world_readable() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("SKILL.md");
        write_atomic(&p, b"x").unwrap();
        assert_eq!(
            std::fs::metadata(&p).unwrap().permissions().mode() & 0o777,
            0o644
        );
    }

    #[test]
    fn rejects_unsafe() {
        assert!(safe_rel("../x").is_err());
        assert!(safe_rel("/etc").is_err());
        assert!(safe_rel("a/b/SKILL.md").is_ok());
    }
}
