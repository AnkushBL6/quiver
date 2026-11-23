//! SKILL.md parsing, Agent Skills spec validation, and folder hashing.

use crate::model::{FileEntry, Issue, IssueKind};
use sha2::{Digest, Sha256};
use std::path::Path;
use walkdir::WalkDir;

pub const SKILL_FILE: &str = "SKILL.md";
const MAX_NAME: usize = 64;
const MAX_DESCRIPTION: usize = 1024;

#[derive(Debug, Clone, Default)]
pub struct Meta {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub license: Option<String>,
    pub allowed_tools: Option<String>,
    pub frontmatter: serde_json::Value,
    pub body: String,
    pub raw: String,
    pub parse_error: Option<String>,
    /// Set when frontmatter was recovered by the lenient parser.
    pub lenient: Option<String>,
}

/// Locate the SKILL.md file of a skill folder (accepts lowercase `skill.md`).
pub fn skill_file(dir: &Path) -> Option<std::path::PathBuf> {
    let upper = dir.join(SKILL_FILE);
    if upper.is_file() {
        return Some(upper);
    }
    let lower = dir.join("skill.md");
    lower.is_file().then_some(lower)
}

pub fn read_meta(dir: &Path) -> Option<Meta> {
    let path = skill_file(dir)?;
    let raw = std::fs::read_to_string(path).ok()?;
    Some(parse(&raw))
}

/// Split `---` frontmatter from the body and parse it as YAML.
pub fn parse(raw: &str) -> Meta {
    let text = raw.strip_prefix('\u{feff}').unwrap_or(raw);
    let mut meta = Meta {
        raw: raw.to_string(),
        frontmatter: serde_json::Value::Object(Default::default()),
        ..Default::default()
    };

    let Some((yaml, body)) = split_frontmatter(text) else {
        meta.body = text.to_string();
        meta.parse_error = Some("SKILL.md has no YAML frontmatter".into());
        return meta;
    };
    meta.body = body.to_string();

    match serde_yaml::from_str::<serde_yaml::Value>(yaml) {
        Ok(value) => {
            let json = serde_json::to_value(&value).unwrap_or(serde_json::Value::Null);
            let get = |k: &str| json.get(k).and_then(scalar_string);
            meta.name = get("name");
            meta.description = get("description").map(|d| d.trim().to_string());
            meta.license = get("license");
            meta.allowed_tools = json.get("allowed-tools").and_then(|v| match v {
                serde_json::Value::Array(items) => Some(
                    items
                        .iter()
                        .filter_map(scalar_string)
                        .collect::<Vec<_>>()
                        .join(" "),
                ),
                other => scalar_string(other),
            });
            meta.version = get("version").or_else(|| {
                json.get("metadata")
                    .and_then(|m| m.get("version"))
                    .and_then(scalar_string)
            });
            if json.is_object() {
                meta.frontmatter = json;
            } else {
                meta.parse_error = Some("frontmatter is not a YAML mapping".into());
            }
        }
        Err(e) => {
            // Many agents parse frontmatter leniently (e.g. unquoted `description: a: b`).
            // Recover simple `key: value` lines so the skill still works, but flag it.
            let loose = loose_frontmatter(yaml);
            let get = |k: &str| loose.get(k).cloned();
            meta.name = get("name");
            meta.description = get("description");
            meta.license = get("license");
            meta.allowed_tools = get("allowed-tools");
            meta.version = get("version");
            meta.frontmatter = serde_json::to_value(&loose).unwrap_or_default();
            meta.lenient = Some(format!(
                "frontmatter isn't strict YAML ({e}); some agents may reject it. Quote values containing ': '."
            ));
        }
    }
    meta
}

/// Best-effort `key: value` parser for top-level frontmatter lines, including
/// `|`/`>` block scalars.
fn loose_frontmatter(yaml: &str) -> std::collections::BTreeMap<String, String> {
    let mut out = std::collections::BTreeMap::new();
    let mut current: Option<(String, Vec<String>)> = None;
    for line in yaml.lines() {
        let top = !line.starts_with([' ', '\t']) && !line.trim().is_empty();
        if top {
            if let Some((k, v)) = current.take() {
                out.insert(k, v.join(" ").trim().to_string());
            }
            if let Some((k, v)) = line.split_once(':') {
                let v = v.trim();
                let v = if matches!(v, "|" | ">" | "|-" | ">-") {
                    ""
                } else {
                    v
                };
                let v = v.trim_matches(|c| c == '"' || c == '\'');
                current = Some((k.trim().to_string(), vec![v.to_string()]));
            }
        } else if let Some((_, v)) = current.as_mut() {
            v.push(line.trim().to_string());
        }
    }
    if let Some((k, v)) = current {
        out.insert(k, v.join(" ").trim().to_string());
    }
    out
}

fn scalar_string(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    }
}

fn split_frontmatter(text: &str) -> Option<(&str, &str)> {
    let rest = text.strip_prefix("---")?;
    let rest = rest
        .strip_prefix("\r\n")
        .or_else(|| rest.strip_prefix('\n'))?;
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            let yaml = &rest[..offset];
            let body = &rest[offset + line.len()..];
            return Some((yaml, body.trim_start_matches(['\r', '\n'])));
        }
        offset += line.len();
    }
    None
}

/// Validate a skill name per the Agent Skills spec.
pub fn name_error(name: &str) -> Option<String> {
    if name.is_empty() || name.len() > MAX_NAME {
        return Some(format!("name must be 1-{MAX_NAME} characters"));
    }
    if !name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    {
        return Some("name may only contain lowercase letters, digits and hyphens".into());
    }
    if name.starts_with('-') || name.ends_with('-') || name.contains("--") {
        return Some("name must not start or end with a hyphen or contain '--'".into());
    }
    None
}

/// Spec issues for a parsed skill living in folder `dir_name`.
pub fn validate(meta: &Meta, dir_name: &str) -> Vec<Issue> {
    let mut issues = Vec::new();
    let warn = |kind, message: String| Issue {
        kind,
        message,
        severity: "warning".into(),
    };
    if let Some(err) = &meta.parse_error {
        issues.push(Issue {
            kind: IssueKind::InvalidFrontmatter,
            message: err.clone(),
            severity: "error".into(),
        });
        return issues;
    }
    if let Some(msg) = &meta.lenient {
        issues.push(warn(IssueKind::InvalidFrontmatter, msg.clone()));
    }
    match &meta.name {
        None => issues.push(warn(
            IssueKind::InvalidName,
            "frontmatter is missing `name`".into(),
        )),
        Some(name) => {
            if let Some(e) = name_error(name) {
                issues.push(warn(IssueKind::InvalidName, format!("`{name}`: {e}")));
            }
            if name != dir_name && !dir_name.ends_with(&format!("--{name}")) {
                issues.push(Issue {
                    kind: IssueKind::NameMismatch,
                    message: format!("folder `{dir_name}` does not match name `{name}`"),
                    severity: "info".into(),
                });
            }
        }
    }
    match &meta.description {
        None => issues.push(Issue {
            kind: IssueKind::MissingDescription,
            message: "missing `description`; agents use it to decide when to load the skill".into(),
            severity: "error".into(),
        }),
        Some(d) if d.is_empty() => issues.push(Issue {
            kind: IssueKind::MissingDescription,
            message: "`description` is empty".into(),
            severity: "error".into(),
        }),
        Some(d) if d.chars().count() > MAX_DESCRIPTION => issues.push(warn(
            IssueKind::DescriptionTooLong,
            format!(
                "description is {} characters (spec max {MAX_DESCRIPTION})",
                d.chars().count()
            ),
        )),
        _ => {}
    }
    issues
}

/// Install-name sanitizer, identical to vercel-labs/skills so lockfile keys match.
pub fn sanitize_name(name: &str) -> String {
    let lower = name.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut dash = false;
    for c in lower.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() || c == '.' || c == '_' {
            out.push(c);
            dash = false;
        } else if !dash {
            out.push('-');
            dash = true;
        }
    }
    let trimmed = out.trim_matches(|c| c == '.' || c == '-');
    let mut s: String = trimmed.chars().take(255).collect();
    if s.is_empty() {
        s = "unnamed-skill".into();
    }
    s
}

fn skip_dir(name: &str) -> bool {
    name == ".git" || name == "node_modules"
}

/// Content hash compatible with vercel-labs/skills `computeSkillFolderHash`:
/// sha256 over (relative path, bytes) of every regular file, sorted by path.
pub fn folder_hash(dir: &Path) -> Option<String> {
    let mut files: Vec<(String, std::path::PathBuf)> = WalkDir::new(dir)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !(e.file_type().is_dir() && skip_dir(&e.file_name().to_string_lossy())))
        .flatten()
        .filter(|e| e.file_type().is_file())
        .map(|e| {
            let rel = e
                .path()
                .strip_prefix(dir)
                .unwrap_or(e.path())
                .to_string_lossy()
                .replace('\\', "/");
            (rel, e.into_path())
        })
        .collect();
    // JS localeCompare ≈ case-insensitive-first ordering; use the same for ASCII paths.
    files.sort_by(|a, b| locale_cmp(&a.0, &b.0));
    let mut hasher = Sha256::new();
    for (rel, path) in files {
        let bytes = std::fs::read(&path).ok()?;
        hasher.update(rel.as_bytes());
        hasher.update(&bytes);
    }
    Some(hex::encode(hasher.finalize()))
}

/// Approximation of ICU root-locale ordering for file paths: punctuation before
/// digits before letters, letters compared case-insensitively, lowercase first on ties.
fn locale_cmp(a: &str, b: &str) -> std::cmp::Ordering {
    fn class(c: char) -> u8 {
        if c.is_ascii_digit() {
            1
        } else if c.is_alphabetic() {
            2
        } else {
            0
        }
    }
    let key = |s: &str| {
        s.chars()
            .map(|c| (class(c), c.to_lowercase().next().unwrap_or(c)))
            .collect::<Vec<_>>()
    };
    key(a).cmp(&key(b)).then_with(|| b.cmp(a))
}

#[derive(Debug, Clone, Default)]
pub struct Stats {
    pub file_count: usize,
    pub size_bytes: u64,
    pub modified_ms: Option<i64>,
}

pub fn stats(dir: &Path) -> Stats {
    let mut s = Stats::default();
    for e in WalkDir::new(dir)
        .follow_links(false)
        .min_depth(1)
        .into_iter()
        .filter_entry(|e| !(e.file_type().is_dir() && skip_dir(&e.file_name().to_string_lossy())))
        .flatten()
    {
        if e.file_type().is_file()
            && let Ok(m) = e.metadata()
        {
            s.file_count += 1;
            s.size_bytes += m.len();
            if let Ok(t) = m.modified() {
                let ms = t
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0);
                s.modified_ms = Some(s.modified_ms.map_or(ms, |cur| cur.max(ms)));
            }
        }
    }
    s
}

pub fn list_files(dir: &Path) -> Vec<FileEntry> {
    let mut out: Vec<FileEntry> = WalkDir::new(dir)
        .follow_links(false)
        .min_depth(1)
        .max_depth(8)
        .into_iter()
        .filter_entry(|e| !(e.file_type().is_dir() && skip_dir(&e.file_name().to_string_lossy())))
        .flatten()
        .take(2000)
        .map(|e| FileEntry {
            path: e
                .path()
                .strip_prefix(dir)
                .unwrap_or(e.path())
                .to_string_lossy()
                .replace('\\', "/"),
            size: if e.file_type().is_file() {
                e.metadata().map(|m| m.len()).unwrap_or(0)
            } else {
                0
            },
            is_dir: e.file_type().is_dir(),
        })
        .collect();
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Scaffold for a brand-new skill.
pub fn template(id: &str, description: &str) -> String {
    let title = id
        .split('-')
        .map(|w| {
            let mut c = w.chars();
            c.next()
                .map(|f| f.to_uppercase().collect::<String>() + c.as_str())
                .unwrap_or_default()
        })
        .collect::<Vec<_>>()
        .join(" ");
    let desc = if description.trim().is_empty() {
        "Describe what this skill does and when an agent should use it.".to_string()
    } else {
        description.trim().replace('\n', " ")
    };
    let desc_yaml = serde_json::to_string(&desc).unwrap_or_else(|_| "\"\"".into());
    format!(
        "---\nname: {id}\ndescription: {desc_yaml}\n---\n\n# {title}\n\n## When to use\n\n- \n\n## Instructions\n\n1. \n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_frontmatter() {
        let m = parse(
            "---\nname: pdf\ndescription: |\n  Work with PDFs.\nlicense: MIT\nmetadata:\n  version: \"2.1\"\nallowed-tools: [Read, Bash]\n---\n\n# PDF\nBody",
        );
        assert_eq!(m.name.as_deref(), Some("pdf"));
        assert_eq!(m.description.as_deref(), Some("Work with PDFs."));
        assert_eq!(m.version.as_deref(), Some("2.1"));
        assert_eq!(m.allowed_tools.as_deref(), Some("Read Bash"));
        assert!(m.body.starts_with("# PDF"));
        assert!(validate(&m, "pdf").is_empty());
    }

    #[test]
    fn reports_spec_issues() {
        let m = parse("---\nname: Bad_Name\n---\nbody");
        let kinds: Vec<_> = validate(&m, "other").iter().map(|i| i.kind).collect();
        assert!(kinds.contains(&IssueKind::InvalidName));
        assert!(kinds.contains(&IssueKind::NameMismatch));
        assert!(kinds.contains(&IssueKind::MissingDescription));
        assert_eq!(
            validate(&parse("no frontmatter"), "x")[0].kind,
            IssueKind::InvalidFrontmatter
        );
        let loose = parse("---\nname: x\ndescription: Use when: things happen\n---\nbody");
        assert_eq!(
            loose.description.as_deref(),
            Some("Use when: things happen")
        );
        let issues = validate(&loose, "x");
        assert_eq!(issues.len(), 1);
        assert_eq!(issues[0].severity, "warning");
    }

    #[test]
    fn sanitizes_like_skills_cli() {
        assert_eq!(sanitize_name("My Skill!"), "my-skill");
        assert_eq!(sanitize_name("..a.b_c--"), "a.b_c");
        assert_eq!(sanitize_name("!!!"), "unnamed-skill");
    }

    #[test]
    fn template_is_valid() {
        let m = parse(&template("my-skill", "Does: things"));
        assert!(
            validate(&m, "my-skill").is_empty(),
            "{:?}",
            validate(&m, "my-skill")
        );
    }
}
