//! Filesystem helpers. Destructive operations go to the Trash (macOS) or the
//! Recycle Bin (Windows) so every change Quiver makes to user data is recoverable.
//!
//! # Directory links
//!
//! Agents see a skill through a directory link in their own skills folder.
//!
//! * **macOS / Linux**: a relative symlink, as it always was.
//! * **Windows**: a *junction* (an NTFS directory reparse point). Junctions need
//!   neither Developer Mode nor admin rights, every agent follows them
//!   transparently, and Rust reports them as links (`is_symlink`), so detection,
//!   `read_link`, broken-link checks and "is this link ours" give the same answers
//!   as on Unix. Junctions only take absolute targets, so Windows links are
//!   absolute. If a junction can't be made, a real directory symlink is tried
//!   (works with Developer Mode, admin, or on volumes without junction support).
//!   If neither works, entries in agent folders fall back to a plain copy
//!   ([`link_or_copy_dir`]); the canonical store itself always needs real links.
//!
//! Set `QUIVER_WINDOWS_LINKS=junction|symlink|copy` to force one strategy (the
//! default is `auto`: junction, then symlink, then copy).

use anyhow::{Context, Result, bail};
use std::path::{Component, Path, PathBuf};

/// What the user calls the place deleted folders go to.
pub const TRASH_NAME: &str = if cfg!(windows) {
    "Recycle Bin"
} else {
    "Trash"
};

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

/// Canonical form of an existing path: links resolved, and on Windows without
/// the `\\?\` verbatim prefix `std::fs::canonicalize` adds (so results compare
/// equal to ordinary paths).
pub fn canonicalize(path: &Path) -> std::io::Result<PathBuf> {
    dunce::canonicalize(path)
}

/// [`canonicalize`], or the path unchanged when it doesn't exist.
pub fn normalize(path: &Path) -> PathBuf {
    canonicalize(path).unwrap_or_else(|_| path.to_path_buf())
}

/// Component-wise `starts_with`, case-insensitive on Windows (NTFS is, by default).
pub fn starts_with(path: &Path, base: &Path) -> bool {
    #[cfg(windows)]
    {
        let lower = |p: &Path| {
            p.components()
                .map(|c| c.as_os_str().to_string_lossy().to_lowercase())
                .collect::<Vec<_>>()
        };
        let (p, b) = (lower(path), lower(base));
        p.len() >= b.len() && p[..b.len()] == b[..]
    }
    #[cfg(not(windows))]
    {
        path.starts_with(base)
    }
}

pub fn entry(path: &Path) -> Entry {
    match std::fs::symlink_metadata(path) {
        Err(_) => Entry::Missing,
        // Symlinks everywhere; junctions too on Windows (Rust reports both as links).
        Ok(m) if m.file_type().is_symlink() => {
            let target = std::fs::read_link(path)
                .map(|t| dunce::simplified(&t).to_path_buf())
                .unwrap_or_default();
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

/// Create the directory link `link` → `target`: a relative symlink on Unix, a
/// junction (or symlink) on Windows; see the module docs.
pub fn symlink_dir(target: &Path, link: &Path) -> Result<()> {
    let parent = link.parent().context("link has no parent")?;
    std::fs::create_dir_all(parent).with_context(|| format!("creating {}", parent.display()))?;
    let parent_real = normalize(parent);
    // Resolve everything but the last component: a link to a store entry must stay a
    // link to that entry (which may itself be a link), not jump to its final target.
    let target_real = match (target.parent(), target.file_name()) {
        (Some(tp), Some(name)) => normalize(tp).join(name),
        _ => target.to_path_buf(),
    };
    #[cfg(unix)]
    {
        let rel = relative(&parent_real, &target_real);
        std::os::unix::fs::symlink(&rel, link)
            .with_context(|| format!("linking {} -> {}", link.display(), rel.display()))
    }
    #[cfg(windows)]
    {
        let _ = parent_real;
        windows::link_dir(&target_real, link)
            .with_context(|| format!("linking {} -> {}", link.display(), target_real.display()))
    }
}

/// Create the directory link `link` → `target` as a real symlink with a RELATIVE
/// target on every platform. Unlike [`symlink_dir`] this never makes a junction:
/// junctions hold absolute paths and can't be committed to git. On Windows it
/// needs Developer Mode or admin rights; callers fall back to copying there.
pub fn symlink_dir_relative(target: &Path, link: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        symlink_dir(target, link)
    }
    #[cfg(windows)]
    {
        let parent = link.parent().context("link has no parent")?;
        std::fs::create_dir_all(parent)
            .with_context(|| format!("creating {}", parent.display()))?;
        let target_real = match (target.parent(), target.file_name()) {
            (Some(tp), Some(name)) => normalize(tp).join(name),
            _ => target.to_path_buf(),
        };
        let rel = relative(&normalize(parent), &target_real);
        std::os::windows::fs::symlink_dir(&rel, link)
            .with_context(|| format!("linking {} -> {}", link.display(), rel.display()))
    }
}

/// Link `dest` to `src`, or, on Windows when no kind of directory link can be
/// created there, copy the folder instead so the agent still sees the skill.
/// Used for agent folders; never for the canonical store.
pub fn link_or_copy_dir(src: &Path, dest: &Path) -> Result<()> {
    match symlink_dir(src, dest) {
        Ok(()) => Ok(()),
        #[cfg(windows)]
        Err(_) => copy_dir(&normalize(src), dest),
        #[cfg(not(windows))]
        Err(e) => Err(e),
    }
}

/// Link with an *absolute* target on every platform (a live link to a folder
/// outside the store, such as a dev checkout).
pub fn symlink_dir_abs(target: &Path, link: &Path) -> Result<()> {
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(target, link)
            .with_context(|| format!("linking {} -> {}", link.display(), target.display()))
    }
    #[cfg(windows)]
    {
        windows::link_dir(target, link)
            .with_context(|| format!("linking {} -> {}", link.display(), target.display()))
    }
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::path::Path;

    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub(super) enum Strategy {
        Auto,
        Junction,
        Symlink,
        /// Never link (locked-down machines, tests): callers fall back to copying.
        Copy,
    }

    pub(super) fn strategy() -> Strategy {
        match std::env::var("QUIVER_WINDOWS_LINKS")
            .map(|v| v.trim().to_ascii_lowercase())
            .as_deref()
        {
            Ok("junction") => Strategy::Junction,
            Ok("symlink") => Strategy::Symlink,
            Ok("copy") => Strategy::Copy,
            _ => Strategy::Auto,
        }
    }

    /// NTFS junction. `junction::create` makes the directory first, so a failure
    /// afterwards leaves an empty folder behind; clean that up.
    pub(super) fn junction(target: &Path, link: &Path) -> io::Result<()> {
        if std::fs::symlink_metadata(link).is_ok() {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "link path already exists",
            ));
        }
        junction::create(target, link).inspect_err(|_| {
            let _ = std::fs::remove_dir(link);
        })
    }

    /// Real directory symlink (needs Developer Mode or admin).
    pub(super) fn symlink(target: &Path, link: &Path) -> io::Result<()> {
        std::os::windows::fs::symlink_dir(target, link)
    }

    pub(super) fn link_dir(target: &Path, link: &Path) -> io::Result<()> {
        match strategy() {
            Strategy::Junction => junction(target, link),
            Strategy::Symlink => symlink(target, link),
            Strategy::Copy => Err(io::Error::new(
                io::ErrorKind::Unsupported,
                "directory links are disabled (QUIVER_WINDOWS_LINKS=copy)",
            )),
            Strategy::Auto => junction(target, link).or_else(|je| {
                symlink(target, link).map_err(|se| {
                    io::Error::new(
                        se.kind(),
                        format!("junction failed ({je}); symlink failed ({se})"),
                    )
                })
            }),
        }
    }
}

/// Remove a symlink (never its target).
pub fn remove_link(path: &Path) -> Result<()> {
    match entry(path) {
        Entry::Link { .. } => {
            remove_link_entry(path).with_context(|| format!("removing link {}", path.display()))
        }
        Entry::Missing => Ok(()),
        _ => bail!("{} is not a symlink", path.display()),
    }
}

/// Windows directory links (junctions and dir symlinks) are removed with
/// `remove_dir`, file symlinks with `remove_file`; neither touches the target.
#[cfg(windows)]
fn remove_link_entry(path: &Path) -> std::io::Result<()> {
    std::fs::remove_dir(path).or_else(|_| std::fs::remove_file(path))
}

#[cfg(not(windows))]
fn remove_link_entry(path: &Path) -> std::io::Result<()> {
    std::fs::remove_file(path)
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
    std::fs::create_dir_all(backup_root)?;
    // Two items of the same name trashed within a millisecond must not merge.
    let mut dest = backup_root.join(format!("{stamp}-{name}"));
    let mut n = 1;
    while std::fs::symlink_metadata(&dest).is_ok() {
        dest = backup_root.join(format!("{stamp}-{n}-{name}"));
        n += 1;
    }
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
            copy_link(e.path(), &dest)?;
        } else {
            std::fs::copy(e.path(), &dest)
                .with_context(|| format!("copying {}", e.path().display()))?;
        }
    }
    Ok(())
}

/// Recreate a link found inside a tree being copied.
fn copy_link(from: &Path, dest: &Path) -> Result<()> {
    let t = std::fs::read_link(from)?;
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(t, dest)?;
        Ok(())
    }
    #[cfg(windows)]
    {
        // Unprivileged Windows can't always create symlinks: link when possible,
        // otherwise copy what the link points at, and skip it when it dangles.
        let resolved = link_target_abs(from, &t);
        if resolved.is_dir() {
            if windows::symlink(&resolved, dest).is_err() {
                copy_dir(&resolved, dest)?;
            }
        } else if resolved.is_file() && std::os::windows::fs::symlink_file(&resolved, dest).is_err()
        {
            std::fs::copy(&resolved, dest)
                .with_context(|| format!("copying {}", resolved.display()))?;
        }
        Ok(())
    }
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
    persist(tmp, path).with_context(|| format!("writing {}", path.display()))
}

/// Move the temp file over `path`. On Windows the destination can be briefly
/// locked by a scanner, indexer or file watcher, so retry a few times.
fn persist(mut tmp: tempfile::NamedTempFile, path: &Path) -> std::io::Result<()> {
    let mut attempts = if cfg!(windows) { 8 } else { 1 };
    loop {
        match tmp.persist(path) {
            Ok(_) => return Ok(()),
            Err(e) if attempts > 1 && e.error.kind() == std::io::ErrorKind::PermissionDenied => {
                attempts -= 1;
                tmp = e.file;
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            Err(e) => return Err(e.error),
        }
    }
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
    // `name:stream` would address an NTFS alternate data stream.
    if cfg!(windows) && rel.contains(':') {
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
        std::fs::write(target.join("SKILL.md"), "hi").unwrap();
        let link = d.path().join("agent/skills/x");
        symlink_dir(&target, &link).unwrap();
        assert!(matches!(entry(&link), Entry::Link { resolves: true, .. }));
        if let Entry::Link { target: t, .. } = entry(&link) {
            // Unix links are relative; Windows junctions are absolute.
            assert_eq!(t.is_relative(), cfg!(unix), "{t:?}");
            assert_eq!(
                canonicalize(&link_target_abs(&link, &t)).unwrap(),
                canonicalize(&target).unwrap()
            );
        }
        assert_eq!(
            std::fs::read_to_string(link.join("SKILL.md")).unwrap(),
            "hi"
        );
        assert_eq!(canonicalize(&link).unwrap(), canonicalize(&target).unwrap());
        remove_link(&link).unwrap();
        assert!(matches!(entry(&link), Entry::Missing));
        assert!(target.join("SKILL.md").exists(), "target survives");
    }

    #[test]
    fn link_chains_and_broken_links() {
        let d = tempfile::tempdir().unwrap();
        let real = d.path().join("my/x");
        std::fs::create_dir_all(&real).unwrap();
        // agent link -> store link -> real folder, as My Skills are wired.
        let store = d.path().join("store/x");
        symlink_dir(&real, &store).unwrap();
        let agent = d.path().join("agent/x");
        symlink_dir(&store, &agent).unwrap();
        assert!(matches!(entry(&agent), Entry::Link { resolves: true, .. }));
        assert_eq!(canonicalize(&agent).unwrap(), canonicalize(&real).unwrap());
        // The agent link points at the store entry, not at the real folder.
        let Entry::Link { target, .. } = entry(&agent) else {
            panic!("not a link")
        };
        assert_eq!(
            normalize(&link_target_abs(&agent, &target)),
            normalize(&store)
        );
        // Removing the real folder breaks both links; they stay detectable links.
        std::fs::remove_dir_all(&real).unwrap();
        assert!(matches!(
            entry(&store),
            Entry::Link {
                resolves: false,
                ..
            }
        ));
        assert!(matches!(
            entry(&agent),
            Entry::Link {
                resolves: false,
                ..
            }
        ));
        remove_link(&agent).unwrap();
        remove_link(&store).unwrap();
        assert!(matches!(entry(&agent), Entry::Missing));
        assert!(matches!(entry(&store), Entry::Missing));
    }

    #[test]
    fn linking_over_an_existing_entry_fails_and_keeps_it() {
        let d = tempfile::tempdir().unwrap();
        let target = d.path().join("t");
        let link = d.path().join("l");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir_all(&link).unwrap();
        std::fs::write(link.join("keep"), "x").unwrap();
        assert!(symlink_dir(&target, &link).is_err());
        assert!(link.join("keep").exists());
    }

    #[test]
    fn copy_dir_skips_git_and_node_modules() {
        let d = tempfile::tempdir().unwrap();
        let src = d.path().join("s");
        std::fs::create_dir_all(src.join(".git")).unwrap();
        std::fs::create_dir_all(src.join("node_modules/x")).unwrap();
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("SKILL.md"), "a").unwrap();
        std::fs::write(src.join("sub/f.txt"), "b").unwrap();
        std::fs::write(src.join(".git/HEAD"), "c").unwrap();
        let dest = d.path().join("d");
        copy_dir(&src, &dest).unwrap();
        assert!(dest.join("SKILL.md").is_file() && dest.join("sub/f.txt").is_file());
        assert!(!dest.join(".git").exists() && !dest.join("node_modules").exists());
    }

    #[cfg(windows)]
    mod windows_links {
        use super::*;

        fn roundtrip(make: fn(&Path, &Path) -> std::io::Result<()>) {
            let d = tempfile::tempdir().unwrap();
            let target = d.path().join("store/x");
            std::fs::create_dir_all(target.join("sub")).unwrap();
            std::fs::write(target.join("SKILL.md"), "hi").unwrap();
            let link = d.path().join("agent/x");
            std::fs::create_dir_all(link.parent().unwrap()).unwrap();
            make(&target, &link).unwrap();

            // Detected as a link whose raw target is absolute and has no \\?\ prefix.
            let Entry::Link {
                target: raw,
                resolves,
            } = entry(&link)
            else {
                panic!("expected a link, got {:?}", entry(&link));
            };
            assert!(resolves);
            assert!(raw.is_absolute(), "{raw:?}");
            assert!(!raw.to_string_lossy().starts_with(r"\\?\"), "{raw:?}");
            assert_eq!(
                normalize(&link_target_abs(&link, &raw)),
                canonicalize(&target).unwrap()
            );
            // Canonicalising through the link gives the plain, prefix-free path.
            let real = canonicalize(&link).unwrap();
            assert_eq!(real, canonicalize(&target).unwrap());
            assert!(!real.to_string_lossy().starts_with(r"\\?\"), "{real:?}");
            assert!(link.join("SKILL.md").is_file() && link.join("sub").is_dir());

            // A directory walk must not descend into the link.
            let walked: Vec<_> = walkdir::WalkDir::new(d.path().join("agent"))
                .follow_links(false)
                .into_iter()
                .flatten()
                .map(|e| e.path().to_path_buf())
                .collect();
            assert_eq!(walked.len(), 2, "{walked:?}");

            // Removing the link leaves the target alone.
            remove_link(&link).unwrap();
            assert!(matches!(entry(&link), Entry::Missing));
            assert!(target.join("SKILL.md").is_file());

            // A link to a vanished folder is a broken link, and still removable.
            make(&target, &link).unwrap();
            std::fs::remove_dir_all(&target).unwrap();
            assert!(matches!(
                entry(&link),
                Entry::Link {
                    resolves: false,
                    ..
                }
            ));
            remove_link(&link).unwrap();
            assert!(matches!(entry(&link), Entry::Missing));
        }

        #[test]
        fn junctions_behave_like_symlinks() {
            roundtrip(super::super::windows::junction);
        }

        #[test]
        fn real_symlinks_when_permitted() {
            let d = tempfile::tempdir().unwrap();
            let (t, l) = (d.path().join("t"), d.path().join("l"));
            std::fs::create_dir_all(&t).unwrap();
            if let Err(e) = super::super::windows::symlink(&t, &l) {
                // Without Developer Mode or admin rights Windows refuses (error 1314).
                eprintln!("skipping: symlinks not permitted here ({e})");
                return;
            }
            std::fs::remove_dir(&l).unwrap();
            roundtrip(super::super::windows::symlink);
        }

        #[test]
        fn junction_cleans_up_after_itself() {
            let d = tempfile::tempdir().unwrap();
            let l = d.path().join("l");
            // A target the junction API can't encode fails after creating the dir.
            let long = d.path().join("x".repeat(40_000));
            assert!(super::super::windows::junction(&long, &l).is_err());
            assert!(matches!(entry(&l), Entry::Missing), "no stray folder");
        }

        #[test]
        fn file_symlinks_in_copied_trees_degrade_to_copies() {
            let d = tempfile::tempdir().unwrap();
            let src = d.path().join("s");
            std::fs::create_dir_all(&src).unwrap();
            std::fs::write(src.join("real.txt"), "payload").unwrap();
            if std::os::windows::fs::symlink_file("real.txt", src.join("alias.txt")).is_err() {
                eprintln!("skipping: symlinks not permitted here");
                return;
            }
            let dest = d.path().join("d");
            copy_dir(&src, &dest).unwrap();
            assert_eq!(
                std::fs::read_to_string(dest.join("alias.txt")).unwrap(),
                "payload"
            );
        }
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
