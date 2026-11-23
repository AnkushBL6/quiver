//! Minimal GitHub client: repo trees, verified raw downloads, tarball fallback.

use crate::fsutil::safe_rel;
use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use sha1::{Digest, Sha1};
use std::io::Read;
use std::path::Path;
use std::time::Duration;

const UA: &str = concat!(
    "quiver/",
    env!("CARGO_PKG_VERSION"),
    " (+https://github.com/AnkushBL6/quiver)"
);
/// Above these limits a folder is fetched via tarball instead of per-file raw downloads.
const RAW_MAX_FILES: usize = 150;
const RAW_MAX_BYTES: u64 = 20 * 1024 * 1024;

#[derive(Debug, Clone)]
pub struct Client {
    agent: ureq::Agent,
    token: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct TreeEntry {
    pub path: String,
    pub mode: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub sha: String,
    #[serde(default)]
    pub size: Option<u64>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Tree {
    pub sha: String,
    pub tree: Vec<TreeEntry>,
    #[serde(default)]
    pub truncated: bool,
}

impl Tree {
    /// Git tree SHA of a folder ("" = repo root). This is what the shared lock
    /// stores as `skillFolderHash`.
    pub fn folder_sha(&self, folder: &str) -> Option<String> {
        if folder.is_empty() {
            return Some(self.sha.clone());
        }
        self.tree
            .iter()
            .find(|e| e.kind == "tree" && e.path == folder)
            .map(|e| e.sha.clone())
    }

    /// The folder holding a skill, following upstream moves: if `folder` is gone,
    /// look for a unique skill folder with the same name elsewhere in the repo.
    pub fn locate(&self, folder: &str) -> Option<String> {
        if self.folder_sha(folder).is_some()
            && (folder.is_empty()
                || self
                    .tree
                    .iter()
                    .any(|e| e.path == format!("{folder}/SKILL.md")))
        {
            return Some(folder.to_string());
        }
        let base = folder.rsplit('/').next().filter(|b| !b.is_empty())?;
        let mut hits = self
            .skill_folders()
            .into_iter()
            .filter(|f| f.rsplit('/').next() == Some(base));
        let first = hits.next()?;
        hits.next().is_none().then_some(first)
    }

    /// Blob entries under a folder.
    pub fn files_in<'a>(&'a self, folder: &'a str) -> impl Iterator<Item = &'a TreeEntry> + 'a {
        let prefix = if folder.is_empty() {
            String::new()
        } else {
            format!("{folder}/")
        };
        self.tree
            .iter()
            .filter(move |e| e.kind == "blob" && e.path.starts_with(&prefix))
    }

    /// Folders containing a SKILL.md.
    pub fn skill_folders(&self) -> Vec<String> {
        let mut v: Vec<String> = self
            .tree
            .iter()
            .filter(|e| e.kind == "blob")
            .filter_map(|e| {
                let (dir, file) = e.path.rsplit_once('/').unwrap_or(("", e.path.as_str()));
                (file == "SKILL.md"
                    && !dir.split('/').any(|seg| {
                        seg == "node_modules"
                            || seg.starts_with('.')
                                && seg != ".claude"
                                && seg != ".agents"
                                && seg != ".github"
                    }))
                .then(|| dir.to_string())
            })
            .collect();
        v.sort();
        v.dedup();
        v
    }
}

impl Client {
    pub fn new(token: Option<String>) -> Self {
        Self::with_timeouts(token, Duration::from_secs(10), Duration::from_secs(60))
    }

    /// For lookups that must fail soft instead of making the user wait.
    pub fn with_timeouts(token: Option<String>, connect: Duration, read: Duration) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(connect)
            .timeout_read(read)
            .user_agent(UA)
            .build();
        Self { agent, token }
    }

    fn get(&self, url: &str) -> ureq::Request {
        let mut r = self.agent.get(url);
        if let Some(t) = &self.token {
            r = r.set("Authorization", &format!("Bearer {t}"));
        }
        r
    }

    fn api_err(e: ureq::Error, what: &str) -> anyhow::Error {
        match e {
            ureq::Error::Status(403, r) | ureq::Error::Status(429, r)
                if r.header("x-ratelimit-remaining") == Some("0") =>
            {
                anyhow!(
                    "GitHub rate limit reached while fetching {what}. Add a GitHub token in Settings (or sign in with `gh auth login`)."
                )
            }
            ureq::Error::Status(404, _) | ureq::Error::Status(401, _) => {
                anyhow!("{what} not found (private repos need a GitHub token in Settings)")
            }
            ureq::Error::Status(code, _) => anyhow!("GitHub returned HTTP {code} for {what}"),
            ureq::Error::Transport(t) => anyhow!("network error fetching {what}: {t}"),
        }
    }

    pub fn tree(&self, repo: &str, git_ref: &str) -> Result<Tree> {
        let url = format!(
            "https://api.github.com/repos/{repo}/git/trees/{}?recursive=1",
            urlencode(git_ref)
        );
        let resp = self
            .get(&url)
            .set("Accept", "application/vnd.github+json")
            .call()
            .map_err(|e| Self::api_err(e, repo))?;
        resp.into_json::<Tree>().context("parsing GitHub tree")
    }

    /// The full commit SHA a tag, branch or (abbreviated) SHA points at. A full
    /// 40-character SHA is returned as is, without a request.
    pub fn resolve_commit(&self, repo: &str, git_ref: &str) -> Result<String> {
        if is_full_sha(git_ref) {
            return Ok(git_ref.to_ascii_lowercase());
        }
        let url = format!(
            "https://api.github.com/repos/{repo}/commits/{}",
            urlencode(git_ref)
        );
        let text = self
            .get(&url)
            .set("Accept", "application/vnd.github.sha")
            .call()
            .map_err(|e| Self::api_err(e, &format!("{repo}@{git_ref}")))?
            .into_string()
            .context("reading GitHub's answer")?;
        let sha = text.trim().to_ascii_lowercase();
        anyhow::ensure!(
            is_full_sha(&sha),
            "GitHub didn't return a commit for `{git_ref}` in {repo}"
        );
        Ok(sha)
    }

    pub fn raw(&self, repo: &str, git_ref: &str, path: &str) -> Result<Vec<u8>> {
        let url = format!(
            "https://raw.githubusercontent.com/{repo}/{}/{}",
            urlencode(git_ref),
            path.split('/').map(urlencode).collect::<Vec<_>>().join("/")
        );
        let resp = self.get(&url).call().map_err(|e| Self::api_err(e, path))?;
        let mut buf = Vec::new();
        resp.into_reader()
            .take(RAW_MAX_BYTES + 1)
            .read_to_end(&mut buf)?;
        Ok(buf)
    }

    /// Download one folder of a repo into `dest`, verifying every blob's git SHA-1.
    pub fn download_folder(
        &self,
        repo: &str,
        git_ref: &str,
        tree: &Tree,
        folder: &str,
        dest: &Path,
    ) -> Result<()> {
        let files: Vec<&TreeEntry> = tree.files_in(folder).collect();
        anyhow::ensure!(!files.is_empty(), "no files under `{folder}` in {repo}");
        let total: u64 = files.iter().filter_map(|f| f.size).sum();
        if tree.truncated || files.len() > RAW_MAX_FILES || total > RAW_MAX_BYTES {
            return self.download_via_tarball(repo, git_ref, folder, dest);
        }
        let prefix_len = if folder.is_empty() {
            0
        } else {
            folder.len() + 1
        };
        use rayon::prelude::*;
        let results: Vec<Result<()>> = files
            .par_iter()
            .with_max_len(1)
            .map(|f| {
                let rel = safe_rel(&f.path[prefix_len..])?;
                let out = dest.join(&rel);
                if f.mode == "120000" {
                    return Ok(()); // symlinks inside skills are skipped for safety
                }
                let bytes = self.raw(repo, git_ref, &f.path)?;
                if git_blob_sha(&bytes) != f.sha {
                    bail!(
                        "checksum mismatch for {} (repo changed during download?)",
                        f.path
                    );
                }
                if let Some(p) = out.parent() {
                    std::fs::create_dir_all(p)?;
                }
                std::fs::write(&out, &bytes)?;
                #[cfg(unix)]
                if f.mode == "100755" {
                    use std::os::unix::fs::PermissionsExt;
                    std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755))?;
                }
                Ok(())
            })
            .collect();
        match results.into_iter().find(Result::is_err) {
            Some(Err(e)) if e.to_string().contains("checksum mismatch") => {
                let _ = std::fs::remove_dir_all(dest);
                self.download_via_tarball(repo, git_ref, folder, dest)
            }
            Some(Err(e)) => Err(e),
            _ => Ok(()),
        }
    }

    /// Stream the repo tarball and extract only `folder`.
    pub fn download_via_tarball(
        &self,
        repo: &str,
        git_ref: &str,
        folder: &str,
        dest: &Path,
    ) -> Result<()> {
        let url = format!(
            "https://api.github.com/repos/{repo}/tarball/{}",
            urlencode(git_ref)
        );
        let resp = self.get(&url).call().map_err(|e| Self::api_err(e, repo))?;
        let gz = flate2::read::GzDecoder::new(resp.into_reader());
        let mut archive = tar::Archive::new(gz);
        let mut found = false;
        for entry in archive.entries()? {
            let mut entry = entry?;
            let path = entry.path()?.to_string_lossy().into_owned();
            // Strip the "<owner>-<repo>-<sha>/" root.
            let Some((_, inner)) = path.split_once('/') else {
                continue;
            };
            let rel = if folder.is_empty() {
                inner
            } else if let Some(r) = inner.strip_prefix(folder).and_then(|r| r.strip_prefix('/')) {
                r
            } else {
                continue;
            };
            if rel.is_empty() || !entry.header().entry_type().is_file() {
                continue;
            }
            let out = dest.join(safe_rel(rel)?);
            if let Some(p) = out.parent() {
                std::fs::create_dir_all(p)?;
            }
            entry.unpack(&out)?;
            found = true;
        }
        anyhow::ensure!(found, "`{folder}` not found in {repo} tarball");
        Ok(())
    }
}

/// A full 40-character hexadecimal commit SHA.
pub fn is_full_sha(s: &str) -> bool {
    s.len() == 40 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// `git hash-object` for a blob.
pub fn git_blob_sha(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(format!("blob {}\0", bytes.len()).as_bytes());
    h.update(bytes);
    hex::encode(h.finalize())
}

fn urlencode(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blob_sha_matches_git() {
        // `printf 'hello\n' | git hash-object --stdin`
        assert_eq!(
            git_blob_sha(b"hello\n"),
            "ce013625030ba8dba906f756967f9e9ca394464a"
        );
    }

    #[test]
    fn recognises_full_shas() {
        assert!(is_full_sha("ce013625030ba8dba906f756967f9e9ca394464a"));
        assert!(is_full_sha("CE013625030BA8DBA906F756967F9E9CA394464A"));
        assert!(!is_full_sha("ce01362"));
        assert!(!is_full_sha("v1.2.0"));
        assert!(!is_full_sha("ge013625030ba8dba906f756967f9e9ca394464a"));
    }

    #[test]
    fn finds_skill_folders() {
        let t = Tree {
            sha: "root".into(),
            truncated: false,
            tree: vec![
                TreeEntry {
                    path: "skills/pdf/SKILL.md".into(),
                    mode: "100644".into(),
                    kind: "blob".into(),
                    sha: "a".into(),
                    size: Some(1),
                },
                TreeEntry {
                    path: "skills/pdf".into(),
                    mode: "040000".into(),
                    kind: "tree".into(),
                    sha: "t1".into(),
                    size: None,
                },
                TreeEntry {
                    path: "SKILL.md".into(),
                    mode: "100644".into(),
                    kind: "blob".into(),
                    sha: "b".into(),
                    size: Some(1),
                },
                TreeEntry {
                    path: "node_modules/x/SKILL.md".into(),
                    mode: "100644".into(),
                    kind: "blob".into(),
                    sha: "c".into(),
                    size: Some(1),
                },
            ],
        };
        assert_eq!(
            t.skill_folders(),
            vec!["".to_string(), "skills/pdf".to_string()]
        );
        assert_eq!(t.folder_sha("skills/pdf").as_deref(), Some("t1"));
        assert_eq!(t.folder_sha("").as_deref(), Some("root"));
    }
}
