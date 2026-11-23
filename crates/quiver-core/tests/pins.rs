//! Pinned skills against a fake home and a fake repository. No network: the
//! `--ref` path runs against a stand-in for GitHub.

use quiver_core::fsutil::{self, Entry, entry};
use quiver_core::github::{Tree, TreeEntry};
use quiver_core::pins::{self, LOCK_FILE, PinRemote};
use quiver_core::*;
use std::fs;
use std::path::{Path, PathBuf};

const QA: &str = "browser-qa";
const PIN: &str = "browser-qa-pinned";

struct Env2 {
    _home: tempfile::TempDir,
    _work: tempfile::TempDir,
    home: PathBuf,
    /// The repository: a folder with a `.git` directory, outside the home.
    repo: PathBuf,
}

impl Env2 {
    fn new() -> Self {
        // SAFETY: every test here wants the same value; set before any thread reads it.
        unsafe { std::env::set_var("QUIVER_NO_TRASH", "1") };
        let home_dir = tempfile::tempdir().unwrap();
        let work_dir = tempfile::tempdir().unwrap();
        let home = fsutil::canonicalize(home_dir.path()).unwrap();
        let repo = fsutil::canonicalize(work_dir.path()).unwrap().join("repo");
        for d in [
            ".claude/skills",
            ".codex",
            ".cursor/skills",
            ".agents/skills",
        ] {
            fs::create_dir_all(home.join(d)).unwrap();
        }
        fs::create_dir_all(repo.join(".git")).unwrap();
        fs::write(repo.join(".git/HEAD"), "ref: refs/heads/main\n").unwrap();
        let e = Self {
            _home: home_dir,
            _work: work_dir,
            home,
            repo,
        };
        e.shared(QA, "Tests the browser.", "Original body.\n");
        e
    }

    fn q(&self) -> Quiver {
        Quiver::with_env(Env::isolated(&self.home))
    }

    fn p(&self, rel: &str) -> PathBuf {
        rel.split('/').fold(self.home.clone(), |a, s| a.join(s))
    }

    fn r(&self, rel: &str) -> PathBuf {
        rel.split('/').fold(self.repo.clone(), |a, s| a.join(s))
    }

    fn project(&self) -> String {
        self.repo.to_string_lossy().into_owned()
    }

    /// A shared skill: SKILL.md plus a script.
    fn shared(&self, name: &str, description: &str, body: &str) {
        let d = self.p(&format!(".agents/skills/{name}"));
        fs::create_dir_all(d.join("scripts")).unwrap();
        fs::write(
            d.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {description}\nlicense: MIT\n---\n{body}"),
        )
        .unwrap();
        fs::write(d.join("scripts/run.sh"), "echo run\n").unwrap();
    }

    fn global_lock(&self) {
        fs::write(
            self.p(".agents/.skill-lock.json"),
            serde_json::json!({
                "version": 3,
                "skills": {
                    QA: {
                        "source": "owner/repo",
                        "sourceType": "github",
                        "sourceUrl": "https://github.com/owner/repo",
                        "skillPath": "skills/browser-qa/SKILL.md",
                        "skillFolderHash": "abc"
                    }
                }
            })
            .to_string(),
        )
        .unwrap();
    }

    fn request(&self, name: &str, mode: PinMode) -> PinRequest {
        PinRequest {
            project: self.project(),
            skill: QA.into(),
            name: name.into(),
            git_ref: None,
            agents: vec![],
            mode,
        }
    }

    fn pin(&self, mode: PinMode) -> ProjectDetail {
        self.q().pin_create(&self.request(PIN, mode)).unwrap()
    }

    fn detail(&self) -> ProjectDetail {
        self.q().project_detail(&self.project()).unwrap()
    }

    fn pin_of(&self, name: &str) -> Pin {
        self.detail()
            .pins
            .into_iter()
            .find(|p| p.name == name)
            .unwrap_or_else(|| panic!("no pin {name}"))
    }

    fn lock_text(&self) -> String {
        fs::read_to_string(self.r(LOCK_FILE)).unwrap()
    }

    fn trash_entries(&self) -> usize {
        fs::read_dir(self.p(".quiver/trash"))
            .map(|r| r.count())
            .unwrap_or(0)
    }
}

fn read(p: &Path) -> String {
    fs::read_to_string(p).unwrap()
}

fn is_dir_entry(p: &Path) -> bool {
    matches!(entry(p), Entry::Dir)
}

// ---------- Creating ----------

#[test]
fn create_writes_the_folder_with_a_rewritten_skill_md_and_a_lock_without_paths() {
    let e = Env2::new();
    e.global_lock();
    let d = e.pin(PinMode::Copy);

    let md = read(&e.r(&format!(".agents/skills/{PIN}/SKILL.md")));
    assert_eq!(
        md,
        format!(
            "---\nname: {PIN}\ndescription: \"Pinned copy of {QA} for this repository; use it instead of {QA} here. Tests the browser.\"\nlicense: MIT\n---\nOriginal body.\n"
        )
    );
    assert_eq!(
        read(&e.r(&format!(".agents/skills/{PIN}/scripts/run.sh"))),
        "echo run\n",
        "everything else is byte-identical"
    );

    assert_eq!(d.pins.len(), 1);
    let pin = &d.pins[0];
    assert_eq!(pin.name, PIN);
    assert_eq!(pin.skill, QA);
    assert_eq!(
        pin.description, "Tests the browser.",
        "the original description"
    );
    assert_eq!(pin.state, PinState::Ok);
    assert_eq!(pin.pinned_from, PinnedFrom::Shared);
    assert_eq!(pin.git_ref, None);
    assert!(pin.hash.starts_with("sha256:") && pin.upstream_hash.is_some());
    assert_ne!(
        pin.hash,
        pin.upstream_hash.clone().unwrap(),
        "SKILL.md was rewritten"
    );
    assert_eq!(pin.shared_changed, Some(false));
    assert!(pin.changed_files.is_empty() && pin.problems.is_empty());
    let src = pin.source.as_ref().unwrap();
    assert_eq!(src.source, "owner/repo");
    assert_eq!(src.kind, "github");
    assert_eq!(
        src.skill_path.as_deref(),
        Some("skills/browser-qa/SKILL.md")
    );
    assert_eq!(
        PathBuf::from(&pin.path),
        e.r(&format!(".agents/skills/{PIN}"))
    );

    assert_eq!(d.summary.name, "repo");
    assert!(d.summary.is_repo && d.summary.exists);
    assert_eq!(d.summary.branch.as_deref(), Some("main"));
    assert_eq!((d.summary.pin_count, d.summary.problem_count), (1, 0));
    assert_eq!(
        d.lock_file.as_deref().map(PathBuf::from),
        Some(e.r(LOCK_FILE))
    );

    // The lock: no absolute or personal paths anywhere.
    let text = e.lock_text();
    for forbidden in [
        e.home.to_string_lossy().as_ref(),
        e.repo.to_string_lossy().as_ref(),
    ] {
        assert!(!text.contains(forbidden), "{text}");
    }
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!(v["version"], 1);
    let lp = &v["pins"][PIN];
    assert_eq!(lp["skill"], QA);
    assert_eq!(lp["pinnedFrom"], "shared");
    assert_eq!(lp["source"], "owner/repo");
    assert_eq!(lp["sourceType"], "github");
    assert_eq!(lp["sourceUrl"], "https://github.com/owner/repo");
    assert_eq!(lp["skillPath"], "skills/browser-qa/SKILL.md");
    assert!(lp["gitRef"].is_null());
    assert_eq!(lp["mode"], "copy");
    assert_eq!(lp["hash"], pin.hash.as_str());
    assert_eq!(lp["files"].as_object().unwrap().len(), 2);
    assert!(lp["pinnedAt"].as_str().unwrap().ends_with('Z'));
    assert_eq!(
        lp["agents"],
        serde_json::json!(["claude-code", "codex", "cursor"])
    );
    assert!(text.ends_with("}\n"));
    assert!(text.contains("\n  \"pins\": {"), "2-space indent");

    // The shared skill and the global folders are untouched.
    assert_eq!(
        read(&e.p(&format!(".agents/skills/{QA}/SKILL.md"))),
        format!(
            "---\nname: {QA}\ndescription: Tests the browser.\nlicense: MIT\n---\nOriginal body.\n"
        )
    );
    assert!(!e.p(".claude/skills").join(PIN).exists());
    assert!(!e.p(".agents/skills").join(PIN).exists());
}

#[test]
fn a_long_description_is_truncated_within_the_limit() {
    let e = Env2::new();
    e.shared(QA, &"long words here ".repeat(150), "b\n");
    e.pin(PinMode::Copy);
    let md = skill::parse(&read(&e.r(&format!(".agents/skills/{PIN}/SKILL.md"))));
    let d = md.description.unwrap();
    assert!(d.chars().count() <= 1024, "{}", d.chars().count());
    assert!(d.ends_with('…'));
    assert!(d.starts_with(&format!("Pinned copy of {QA} for this repository")));
    assert_eq!(md.name.as_deref(), Some(PIN));
}

#[cfg(unix)]
#[test]
fn symlink_mode_links_relatively_and_skips_native_agents() {
    let e = Env2::new();
    let d = e.pin(PinMode::Symlink);
    let link = e.r(&format!(".claude/skills/{PIN}"));
    let Entry::Link { target, resolves } = entry(&link) else {
        panic!("not a link");
    };
    assert!(resolves);
    assert_eq!(
        target,
        PathBuf::from(format!("../../.agents/skills/{PIN}")),
        "relative, so git stores it portably"
    );
    // Codex and Cursor read .agents/skills themselves: nothing is created for them.
    assert!(!e.r(".codex").exists() && !e.r(".cursor").exists());
    let kinds: Vec<(&str, PinLinkKind, &str)> = d.pins[0]
        .agents
        .iter()
        .map(|a| (a.agent_id.as_str(), a.kind, a.dir.as_str()))
        .collect();
    assert_eq!(
        kinds,
        vec![
            (
                "claude-code",
                PinLinkKind::Symlink,
                ".claude/skills/browser-qa-pinned"
            ),
            (
                "codex",
                PinLinkKind::Native,
                ".agents/skills/browser-qa-pinned"
            ),
            (
                "cursor",
                PinLinkKind::Native,
                ".agents/skills/browser-qa-pinned"
            ),
        ]
    );
    assert!(d.pins[0].agents.iter().all(|a| a.ok && a.problem.is_none()));
    assert_eq!(d.pins[0].mode, PinMode::Symlink);
    // The pinned folder itself holds no links.
    assert!(
        walk(&e.r(&format!(".agents/skills/{PIN}")))
            .iter()
            .all(|p| !fs::symlink_metadata(p).unwrap().file_type().is_symlink())
    );
    assert!(
        pins::verify_project(&e.repo)
            .unwrap()
            .iter()
            .all(|c| c.pin.state == PinState::Ok)
    );
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![];
    for e in fs::read_dir(dir).unwrap().flatten() {
        out.push(e.path());
        if e.file_type().unwrap().is_dir() {
            out.extend(walk(&e.path()));
        }
    }
    out
}

#[test]
fn copy_mode_makes_a_full_copy_per_folder_shared_by_agents() {
    let e = Env2::new();
    let d = e.pin(PinMode::Copy);
    let copy = e.r(&format!(".claude/skills/{PIN}"));
    assert!(is_dir_entry(&copy));
    assert_eq!(
        read(&copy.join("SKILL.md")),
        read(&e.r(&format!(".agents/skills/{PIN}/SKILL.md")))
    );
    assert!(copy.join("scripts/run.sh").is_file());
    assert_eq!(d.pins[0].mode, PinMode::Copy);
    assert_eq!(d.pins[0].agents[0].kind, PinLinkKind::Copy);
    assert_eq!(d.pins[0].state, PinState::Ok);
}

#[test]
fn several_agents_sharing_a_folder_get_one_entry() {
    let e = Env2::new();
    let mut req = e.request(PIN, PinMode::Copy);
    // Cursor and Codex read .agents/skills; Windsurf has its own folder.
    req.agents = vec![
        "cursor".into(),
        "codex".into(),
        "windsurf".into(),
        "cursor".into(),
    ];
    let d = e.q().pin_create(&req).unwrap();
    assert!(is_dir_entry(&e.r(&format!(".windsurf/skills/{PIN}"))));
    assert!(!e.r(".claude").exists(), "only the chosen agents");
    assert_eq!(d.pins[0].agents.len(), 3, "duplicates collapse");
    assert_eq!(d.pins[0].state, PinState::Ok);
}

#[test]
fn ignored_files_are_neither_copied_nor_hashed() {
    let e = Env2::new();
    let s = e.p(&format!(".agents/skills/{QA}"));
    fs::create_dir_all(s.join("node_modules/x")).unwrap();
    fs::write(s.join("node_modules/x/i.js"), "x").unwrap();
    fs::create_dir_all(s.join(".git")).unwrap();
    fs::write(s.join(".git/HEAD"), "x").unwrap();
    fs::write(s.join(".DS_Store"), "x").unwrap();
    e.pin(PinMode::Copy);
    let pin_dir = e.r(&format!(".agents/skills/{PIN}"));
    assert!(!pin_dir.join("node_modules").exists() && !pin_dir.join(".git").exists());
    assert!(!pin_dir.join(".DS_Store").exists());
    // Droppings in the pin later don't count as edits.
    fs::write(pin_dir.join(".DS_Store"), "junk").unwrap();
    fs::write(pin_dir.join("Thumbs.db"), "junk").unwrap();
    assert_eq!(e.pin_of(PIN).state, PinState::Ok);
}

#[cfg(unix)]
#[test]
fn links_inside_a_skill_are_followed_but_never_out_of_it() {
    let e = Env2::new();
    let s = e.p(&format!(".agents/skills/{QA}"));
    fs::create_dir_all(s.join("lib")).unwrap();
    fs::write(s.join("lib/helper.txt"), "help\n").unwrap();
    std::os::unix::fs::symlink("lib/helper.txt", s.join("alias.txt")).unwrap();
    std::os::unix::fs::symlink("lib", s.join("libs")).unwrap();
    e.pin(PinMode::Copy);
    let pin_dir = e.r(&format!(".agents/skills/{PIN}"));
    assert_eq!(read(&pin_dir.join("alias.txt")), "help\n");
    assert_eq!(read(&pin_dir.join("libs/helper.txt")), "help\n");
    assert!(
        !fs::symlink_metadata(pin_dir.join("alias.txt"))
            .unwrap()
            .file_type()
            .is_symlink(),
        "self-contained: real files"
    );

    // A link out of the skill refuses the pin, and nothing is left behind.
    let e = Env2::new();
    let secret = e.home.join("secret.txt");
    fs::write(&secret, "s").unwrap();
    std::os::unix::fs::symlink(&secret, e.p(&format!(".agents/skills/{QA}/leak.txt"))).unwrap();
    let err = e
        .q()
        .pin_create(&e.request(PIN, PinMode::Copy))
        .unwrap_err();
    assert!(
        format!("{err:#}").contains("outside the skill folder"),
        "{err:#}"
    );
    assert!(!e.r(".agents").exists());
}

#[test]
fn default_agents_skip_generic_project_folders() {
    let e = Env2::new();
    // OpenClaw reads a repo's `skills/` folder: far too generic to write into unasked.
    fs::create_dir_all(e.p(".openclaw")).unwrap();
    e.pin(PinMode::Copy);
    assert!(!e.r("skills").exists());
    assert!(!e.lock_text().contains("openclaw"));
}

#[test]
fn explicit_agents_must_exist_and_have_a_project_folder() {
    let e = Env2::new();
    let mut req = e.request(PIN, PinMode::Copy);
    req.agents = vec!["no-such-agent".into()];
    assert!(format!("{:#}", e.q().pin_create(&req).unwrap_err()).contains("unknown agent"));
    // A Claude Code profile (CLAUDE_CONFIG_DIR style) has no project folder of its own.
    fs::create_dir_all(e.p(".claude-work/skills")).unwrap();
    req.agents = vec!["claude-code@work".into()];
    let err = format!("{:#}", e.q().pin_create(&req).unwrap_err());
    assert!(err.contains("no project-level skills folder"), "{err}");
    assert!(!e.r(".agents").exists());
}

// ---------- Verify ----------

#[test]
fn editing_a_pin_marks_it_modified_and_lists_the_files() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let dir = e.r(&format!(".agents/skills/{PIN}"));
    fs::write(
        dir.join("SKILL.md"),
        format!("{}\nextra line\n", read(&dir.join("SKILL.md"))),
    )
    .unwrap();
    fs::write(dir.join("notes.md"), "new\n").unwrap();
    fs::remove_file(dir.join("scripts/run.sh")).unwrap();

    let pin = e.pin_of(PIN);
    assert_eq!(pin.state, PinState::Modified);
    assert_eq!(
        pin.changed_files,
        vec!["SKILL.md", "notes.md", "scripts/run.sh"]
    );
    assert!(
        pin.problems.iter().any(|p| p.contains("3 files changed")),
        "{:?}",
        pin.problems
    );
    let d = e.detail();
    assert_eq!((d.summary.pin_count, d.summary.problem_count), (1, 1));

    // The no-home check sees the same thing, with the kind of change.
    let c = &pins::verify_project(&e.repo).unwrap()[0];
    assert_eq!(c.pin.state, PinState::Modified);
    assert_eq!(c.changed, vec!["SKILL.md"]);
    assert_eq!(c.added, vec!["notes.md"]);
    assert_eq!(c.removed, vec!["scripts/run.sh"]);

    // Accepting the edits makes it pass again, and the copies follow.
    let d = e.q().pin_accept(&e.project(), PIN).unwrap();
    assert_eq!(d.pins[0].state, PinState::Ok, "{:?}", d.pins[0].problems);
    assert!(
        read(&e.r(&format!(".claude/skills/{PIN}/SKILL.md"))).ends_with("extra line\n"),
        "copy follows the accepted pin"
    );
}

#[test]
fn line_ending_changes_alone_do_not_modify_a_pin() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let dir = e.r(&format!(".agents/skills/{PIN}"));
    for f in ["SKILL.md", "scripts/run.sh"] {
        let text = read(&dir.join(f));
        fs::write(dir.join(f), text.replace('\n', "\r\n")).unwrap();
    }
    assert!(read(&dir.join("SKILL.md")).contains("\r\n"));
    // Hashes see through line endings: the pin and its (LF) copy are still fine.
    let c = &pins::verify_project(&e.repo).unwrap()[0];
    assert_eq!(c.pin.state, PinState::Ok, "{:?}", c.pin.problems);
    assert!(c.pin.changed_files.is_empty());
    assert_eq!(e.pin_of(PIN).state, PinState::Ok);

    // Binary files are hashed as they are: CRLF there is a real change.
    fs::write(dir.join("blob.bin"), b"\0a\nb").unwrap();
    let e2 = Env2::new();
    fs::write(e2.p(&format!(".agents/skills/{QA}/blob.bin")), b"\0a\r\nb").unwrap();
    e2.pin(PinMode::Copy);
    let d2 = e2.r(&format!(".agents/skills/{PIN}/blob.bin"));
    fs::write(&d2, b"\0a\nb").unwrap();
    assert_eq!(e2.pin_of(PIN).changed_files, vec!["blob.bin"]);
}

#[test]
fn a_missing_pin_folder_is_reported_as_missing() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    fs::remove_dir_all(e.r(&format!(".agents/skills/{PIN}"))).unwrap();
    let pin = e.pin_of(PIN);
    assert_eq!(pin.state, PinState::Missing);
    assert!(pin.problems[0].contains("missing"));
    assert_eq!(pin.description, "");
    // Sync can't conjure the content back, but doesn't fail either.
    let d = e.q().pin_sync(&e.project()).unwrap();
    assert_eq!(d.pins[0].state, PinState::Missing);
    // Re-pinning from the shared copy restores it.
    let d = e.q().pin_update(&e.project(), PIN, None).unwrap();
    assert_eq!(d.pins[0].state, PinState::Ok);
}

#[cfg(unix)]
#[test]
fn a_missing_or_wrong_link_is_reported_as_links_and_sync_repairs_it() {
    let e = Env2::new();
    e.pin(PinMode::Symlink);
    let link = e.r(&format!(".claude/skills/{PIN}"));

    // Missing.
    fsutil::remove_link(&link).unwrap();
    let pin = e.pin_of(PIN);
    assert_eq!(pin.state, PinState::Links);
    assert!(!pin.agents[0].ok);
    assert!(
        pin.agents[0]
            .problem
            .as_deref()
            .unwrap()
            .contains("missing")
    );
    assert!(pin.problems[0].starts_with(".claude/skills/browser-qa-pinned:"));
    assert!(pin.changed_files.is_empty());
    let d = e.q().pin_sync(&e.project()).unwrap();
    assert_eq!(d.pins[0].state, PinState::Ok);
    assert!(matches!(entry(&link), Entry::Link { resolves: true, .. }));

    // Pointing somewhere else.
    fs::create_dir_all(e.r("elsewhere")).unwrap();
    fsutil::remove_link(&link).unwrap();
    std::os::unix::fs::symlink("../../elsewhere", &link).unwrap();
    let pin = e.pin_of(PIN);
    assert_eq!(pin.state, PinState::Links);
    assert!(
        pin.agents[0]
            .problem
            .as_deref()
            .unwrap()
            .contains("points somewhere other")
    );
    assert_eq!(
        e.q().pin_sync(&e.project()).unwrap().pins[0].state,
        PinState::Ok
    );
    assert!(e.r("elsewhere").is_dir(), "the other folder is not touched");

    // Broken.
    fsutil::remove_link(&link).unwrap();
    std::os::unix::fs::symlink("../../nowhere", &link).unwrap();
    assert!(
        e.pin_of(PIN).agents[0]
            .problem
            .as_deref()
            .unwrap()
            .contains("broken")
    );
    assert_eq!(
        e.q().pin_sync(&e.project()).unwrap().pins[0].state,
        PinState::Ok
    );

    // Checked out as a text file (git core.symlinks=false).
    fsutil::remove_link(&link).unwrap();
    fs::write(&link, format!("../../.agents/skills/{PIN}")).unwrap();
    let pin = e.pin_of(PIN);
    assert_eq!(pin.state, PinState::Links);
    let problem = pin.agents[0].problem.clone().unwrap();
    assert!(
        problem.contains("core.symlinks") && problem.contains("copy mode"),
        "{problem}"
    );
    assert_eq!(
        e.q().pin_sync(&e.project()).unwrap().pins[0].state,
        PinState::Ok
    );
    assert!(matches!(entry(&link), Entry::Link { .. }));
}

#[test]
fn a_missing_or_edited_copy_is_reported_and_sync_repairs_it() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let copy = e.r(&format!(".claude/skills/{PIN}"));

    fs::remove_dir_all(&copy).unwrap();
    let pin = e.pin_of(PIN);
    assert_eq!(pin.state, PinState::Links);
    assert!(
        pin.agents[0]
            .problem
            .as_deref()
            .unwrap()
            .contains("copy is missing")
    );
    assert_eq!(
        e.q().pin_sync(&e.project()).unwrap().pins[0].state,
        PinState::Ok
    );
    assert!(copy.join("SKILL.md").is_file());

    fs::write(copy.join("SKILL.md"), "edited copy\n").unwrap();
    let pin = e.pin_of(PIN);
    assert_eq!(pin.state, PinState::Links, "the pin itself is fine");
    assert!(
        pin.agents[0]
            .problem
            .as_deref()
            .unwrap()
            .contains("differs")
    );
    assert!(pin.changed_files.is_empty());
    let before = e.trash_entries();
    assert_eq!(
        e.q().pin_sync(&e.project()).unwrap().pins[0].state,
        PinState::Ok
    );
    assert!(
        read(&copy.join("SKILL.md")).starts_with("---\nname: browser-qa-pinned"),
        "copy restored from the pin"
    );
    assert_eq!(
        e.trash_entries(),
        before + 1,
        "the edited copy was kept in the trash"
    );
}

#[test]
fn sync_never_changes_the_lock_or_the_pinned_content() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let lock = e.lock_text();
    let pin_dir = e.r(&format!(".agents/skills/{PIN}"));
    fs::write(pin_dir.join("SKILL.md"), "hand edit\n").unwrap();
    fs::remove_dir_all(e.r(&format!(".claude/skills/{PIN}"))).unwrap();
    let d = e.q().pin_sync(&e.project()).unwrap();
    assert_eq!(read(&pin_dir.join("SKILL.md")), "hand edit\n");
    assert_eq!(e.lock_text(), lock);
    assert_eq!(d.pins[0].state, PinState::Modified);
}

#[test]
fn verify_needs_no_home_and_rejects_hostile_locks() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    // Only the project folder is involved: no Env, no ~/.agents.
    let checks = pins::verify_project(&e.repo).unwrap();
    assert_eq!(checks.len(), 1);
    assert_eq!(checks[0].pin.state, PinState::Ok);
    assert_eq!(checks[0].pin.shared_changed, None);
    assert!(checks[0].pin.name_clash.is_empty());
    assert!(
        pins::verify_project(&e.repo.join("nothing"))
            .unwrap()
            .is_empty()
    );

    let lock = e.lock_text();
    for (what, bad) in [
        ("path in a pin name", lock.replace(PIN, "../../escape")),
        ("not json", "{".to_string()),
        (
            "newer version",
            lock.replace("\"version\": 1", "\"version\": 2"),
        ),
        (
            "path as skill",
            lock.replace("\"skill\": \"browser-qa\"", "\"skill\": \"../x\""),
        ),
    ] {
        fs::write(e.r(LOCK_FILE), bad).unwrap();
        assert!(pins::verify_project(&e.repo).is_err(), "{what}");
    }
}

// ---------- Update ----------

#[test]
fn update_re_pins_from_the_shared_copy() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let first = e.pin_of(PIN);
    assert_eq!(first.shared_changed, Some(false));

    e.shared(QA, "Tests the browser better.", "Fixed body.\n");
    let stale = e.pin_of(PIN);
    assert_eq!(
        stale.shared_changed,
        Some(true),
        "informational, not a failure"
    );
    assert_eq!(stale.state, PinState::Ok);

    let d = e.q().pin_update(&e.project(), PIN, None).unwrap();
    let pin = &d.pins[0];
    assert_eq!(pin.state, PinState::Ok);
    assert_eq!(pin.shared_changed, Some(false));
    assert_ne!(pin.hash, first.hash);
    assert_eq!(pin.description, "Tests the browser better.");
    let md = read(&e.r(&format!(".agents/skills/{PIN}/SKILL.md")));
    assert!(md.contains("Fixed body.") && md.contains(&format!("name: {PIN}")));
    assert_eq!(
        read(&e.r(&format!(".claude/skills/{PIN}/SKILL.md"))),
        md,
        "copies follow"
    );
    assert_eq!(pin.name, PIN, "the name stays");
    assert_eq!(e.detail().pins.len(), 1);
}

#[test]
fn update_keeps_hand_edits_in_the_trash() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let dir = e.r(&format!(".agents/skills/{PIN}"));
    fs::write(dir.join("mine.md"), "my notes\n").unwrap();
    assert_eq!(e.pin_of(PIN).state, PinState::Modified);
    let before = e.trash_entries();
    let d = e.q().pin_update(&e.project(), PIN, None).unwrap();
    assert_eq!(d.pins[0].state, PinState::Ok);
    assert!(!dir.join("mine.md").exists());
    assert!(
        e.trash_entries() > before,
        "the edited folder went to the trash"
    );

    // An untouched pin leaves nothing behind in the trash.
    let before = e.trash_entries();
    e.q().pin_update(&e.project(), PIN, None).unwrap();
    assert_eq!(e.trash_entries(), before);
}

#[test]
fn a_failed_update_keeps_the_old_pin() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let lock = e.lock_text();
    fs::remove_dir_all(e.p(&format!(".agents/skills/{QA}"))).unwrap();
    assert!(e.q().pin_update(&e.project(), PIN, None).is_err());
    assert_eq!(e.lock_text(), lock);
    assert_eq!(e.pin_of(PIN).state, PinState::Ok);
    assert_eq!(
        e.pin_of(PIN).shared_changed,
        None,
        "no shared copy to compare"
    );
    assert!(
        walk(&e.r(".agents"))
            .iter()
            .all(|p| !p.to_string_lossy().contains(".quiver-tmp")),
        "no staging leftovers"
    );
}

// ---------- Unpin ----------

#[test]
fn unpin_trashes_the_folder_and_copies_and_deletes_the_empty_lock() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let before = e.trash_entries();
    let d = e.q().pin_remove(&e.project(), PIN).unwrap();
    assert!(d.pins.is_empty());
    assert_eq!(d.lock_file, None);
    assert!(!e.r(LOCK_FILE).exists(), "the lock goes with the last pin");
    assert!(!e.r(&format!(".agents/skills/{PIN}")).exists());
    assert!(!e.r(&format!(".claude/skills/{PIN}")).exists());
    assert!(
        !e.r(".agents").exists() && !e.r(".claude").exists(),
        "empty folders are tidied"
    );
    assert_eq!(
        e.trash_entries(),
        before + 2,
        "pinned folder and copy are recoverable"
    );
    // The shared skill is untouched.
    assert!(e.p(&format!(".agents/skills/{QA}/SKILL.md")).is_file());
    assert!(e.q().pin_remove(&e.project(), PIN).is_err(), "already gone");
}

#[cfg(unix)]
#[test]
fn unpin_removes_only_links_that_lead_to_the_pin() {
    let e = Env2::new();
    e.pin(PinMode::Symlink);
    let mut req = e.request("browser-qa-release", PinMode::Symlink);
    req.git_ref = None;
    e.q().pin_create(&req).unwrap();
    // A user's own link in the same folder stays.
    fs::create_dir_all(e.r("docs")).unwrap();
    std::os::unix::fs::symlink("../../docs", e.r(".claude/skills/docs")).unwrap();

    let d = e.q().pin_remove(&e.project(), PIN).unwrap();
    assert!(matches!(
        entry(&e.r(&format!(".claude/skills/{PIN}"))),
        Entry::Missing
    ));
    assert!(matches!(
        entry(&e.r(".claude/skills/browser-qa-release")),
        Entry::Link { resolves: true, .. }
    ));
    assert!(matches!(
        entry(&e.r(".claude/skills/docs")),
        Entry::Link { .. }
    ));
    assert_eq!(d.pins.len(), 1, "the other pin stays");
    assert!(e.r(LOCK_FILE).is_file());
    assert!(!e.lock_text().contains(&format!("\"{PIN}\"")));
    assert_eq!(d.pins[0].state, PinState::Ok);
    // The pinned folder went to the trash, and nothing links into it any more.
    assert!(!e.r(&format!(".agents/skills/{PIN}")).exists());
}

// ---------- Safety ----------

#[test]
fn refuses_the_home_folder_and_global_folders_as_a_project() {
    let e = Env2::new();
    let mut req = e.request(PIN, PinMode::Copy);

    req.project = e.home.to_string_lossy().into_owned();
    let err = format!("{:#}", e.q().pin_create(&req).unwrap_err());
    assert!(err.contains("home folder"), "{err}");
    assert!(e.q().project_add(&req.project.clone()).is_err());

    // Inside the shared store or an agent's global folder.
    fs::create_dir_all(e.p(".agents/skills/some-skill")).unwrap();
    for inside in [".agents/skills/some-skill", ".claude/skills"] {
        req.project = e.p(inside).to_string_lossy().into_owned();
        let err = format!("{:#}", e.q().pin_create(&req).unwrap_err());
        assert!(err.contains("is inside"), "{inside}: {err}");
    }
    assert!(!e.p(".agents/skills/some-skill/.agents").exists());
    assert!(!e.p(".claude/skills/.agents").exists());
    assert!(e.q().settings.projects.is_empty());
}

#[cfg(unix)]
#[test]
fn refuses_a_project_whose_agents_skills_is_the_global_store() {
    let e = Env2::new();
    fs::create_dir_all(e.r(".agents")).unwrap();
    std::os::unix::fs::symlink(e.p(".agents/skills"), e.r(".agents/skills")).unwrap();
    let err = format!(
        "{:#}",
        e.q()
            .pin_create(&e.request(PIN, PinMode::Copy))
            .unwrap_err()
    );
    assert!(err.contains("same folder"), "{err}");
    assert!(!e.p(&format!(".agents/skills/{PIN}")).exists());

    // Same when it only becomes a global folder through a link higher up.
    let e = Env2::new();
    std::os::unix::fs::symlink(e.p(".agents"), e.r(".agents")).unwrap();
    assert!(e.q().pin_create(&e.request(PIN, PinMode::Copy)).is_err());
    assert!(!e.p(&format!(".agents/skills/{PIN}")).exists());
}

#[cfg(unix)]
#[test]
fn refuses_to_write_through_an_agent_folder_that_leads_into_a_global_one() {
    let e = Env2::new();
    fs::create_dir_all(e.r(".claude")).unwrap();
    std::os::unix::fs::symlink(e.p(".claude/skills"), e.r(".claude/skills")).unwrap();
    let err = format!(
        "{:#}",
        e.q()
            .pin_create(&e.request(PIN, PinMode::Symlink))
            .unwrap_err()
    );
    assert!(err.contains("leads into"), "{err}");
    assert!(!e.p(&format!(".claude/skills/{PIN}")).exists());
    assert!(!e.r(".agents").exists(), "rolled back");
}

#[test]
fn refuses_bad_names() {
    let e = Env2::new();
    for bad in [
        "Bad_Name",
        "-x",
        "x-",
        "a--b",
        "a b",
        "../x",
        "UPPER",
        "",
        &"x".repeat(65),
    ] {
        let c = e.q().pin_check_name(&e.project(), bad);
        assert!(!c.ok && c.message.is_some(), "{bad:?}");
        let mut req = e.request(bad, PinMode::Copy);
        req.name = bad.to_string();
        assert!(e.q().pin_create(&req).is_err(), "{bad:?}");
    }
    assert!(!e.r(".agents").exists());
    let ok = e.q().pin_check_name(&e.project(), "browser-qa-release");
    assert!(ok.ok && ok.message.is_none());
}

#[test]
fn refuses_names_that_exist_globally_and_explains_the_precedence() {
    let e = Env2::new();
    // The skill's own name, and any other global skill's name.
    e.shared("other-skill", "x", "y\n");
    fs::create_dir_all(e.p(".claude/skills/claude-only")).unwrap();
    fs::write(
        e.p(".claude/skills/claude-only/SKILL.md"),
        "---\nname: claude-only\ndescription: d\n---\n",
    )
    .unwrap();
    for name in [QA, "other-skill", "claude-only"] {
        let c = e.q().pin_check_name(&e.project(), name);
        assert!(!c.ok, "{name}");
        let m = c.message.unwrap();
        assert!(
            m.contains("Claude Code ranks personal skills above project ones"),
            "{m}"
        );
        assert!(
            m.contains(&format!("`{name}-pinned`")),
            "suggests a free name: {m}"
        );
        let mut req = e.request(name, PinMode::Copy);
        req.name = name.into();
        assert!(e.q().pin_create(&req).is_err());
    }
    assert!(!e.r(".agents").exists());
}

#[test]
fn refuses_existing_pins_folders_and_entries() {
    let e = Env2::new();
    // A folder of that name already in the project.
    fs::create_dir_all(e.r(&format!(".agents/skills/{PIN}"))).unwrap();
    fs::write(e.r(&format!(".agents/skills/{PIN}/keep.txt")), "mine").unwrap();
    let err = format!(
        "{:#}",
        e.q()
            .pin_create(&e.request(PIN, PinMode::Copy))
            .unwrap_err()
    );
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(
        read(&e.r(&format!(".agents/skills/{PIN}/keep.txt"))),
        "mine"
    );
    assert!(!e.r(LOCK_FILE).exists());
    fs::remove_dir_all(e.r(".agents")).unwrap();

    // An agent folder entry of that name.
    fs::create_dir_all(e.r(&format!(".claude/skills/{PIN}"))).unwrap();
    fs::write(e.r(&format!(".claude/skills/{PIN}/keep.txt")), "mine").unwrap();
    let err = format!(
        "{:#}",
        e.q()
            .pin_create(&e.request(PIN, PinMode::Copy))
            .unwrap_err()
    );
    assert!(err.contains("already exists"), "{err}");
    assert_eq!(
        read(&e.r(&format!(".claude/skills/{PIN}/keep.txt"))),
        "mine"
    );
    assert!(!e.r(".agents").exists());
    fs::remove_dir_all(e.r(".claude")).unwrap();

    // Already a pin: the lock has the name.
    e.pin(PinMode::Copy);
    let c = e.q().pin_check_name(&e.project(), PIN);
    assert!(!c.ok && c.message.unwrap().contains("already a pin"));
    assert!(e.q().pin_create(&e.request(PIN, PinMode::Copy)).is_err());
    assert_eq!(e.detail().pins.len(), 1);
}

#[test]
fn refuses_skills_that_are_not_shared() {
    let e = Env2::new();
    let mut req = e.request(PIN, PinMode::Copy);
    req.skill = "does-not-exist".into();
    let err = format!("{:#}", e.q().pin_create(&req).unwrap_err());
    assert!(err.contains("isn't in your shared skills"), "{err}");
    // Only in one agent's folder: adopt first.
    fs::create_dir_all(e.p(".cursor/skills/stray")).unwrap();
    fs::write(
        e.p(".cursor/skills/stray/SKILL.md"),
        "---\nname: stray\ndescription: d\n---\n",
    )
    .unwrap();
    req.skill = "stray".into();
    assert!(format!("{:#}", e.q().pin_create(&req).unwrap_err()).contains("quiver adopt stray"));
    req.skill = "../x".into();
    assert!(e.q().pin_create(&req).is_err());
    assert!(!e.r(".agents").exists());
}

#[test]
fn a_failure_midway_rolls_everything_back() {
    let e = Env2::new();
    // `.claude` is a file, so the link folder can't be created after the pin folder is in place.
    fs::write(e.r(".claude"), "not a folder").unwrap();
    let err = e
        .q()
        .pin_create(&e.request(PIN, PinMode::Copy))
        .unwrap_err();
    let _ = err;
    assert!(!e.r(".agents").exists(), "pin folder and staging are gone");
    assert!(!e.r(LOCK_FILE).exists());
    assert_eq!(read(&e.r(".claude")), "not a folder");
}

#[test]
fn pin_operations_never_touch_global_state() {
    let e = Env2::new();
    e.global_lock();
    let snapshot = |e: &Env2| -> Vec<(PathBuf, Vec<u8>)> {
        let mut v: Vec<_> = walk(&e.home)
            .into_iter()
            .filter(|p| p.is_file() && !p.starts_with(e.p(".quiver")))
            .map(|p| {
                let b = fs::read(&p).unwrap();
                (p, b)
            })
            .collect();
        v.sort();
        v
    };
    let before = snapshot(&e);
    let q = e.q();
    q.pin_create(&e.request(PIN, PinMode::Copy)).unwrap();
    q.pin_update(&e.project(), PIN, None).unwrap();
    q.pin_sync(&e.project()).unwrap();
    q.pin_compare(&e.project(), PIN).unwrap();
    q.pin_remove(&e.project(), PIN).unwrap();
    assert_eq!(
        snapshot(&e),
        before,
        "store, agent folders and the global lock are unchanged"
    );
}

// ---------- Name clashes, shared changes, inventory ----------

#[test]
fn name_clash_lists_the_agents_whose_global_folder_has_the_name() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    assert!(e.pin_of(PIN).name_clash.is_empty());

    // Someone later installs a global skill with the pin's name.
    fs::create_dir_all(e.p(&format!(".claude/skills/{PIN}"))).unwrap();
    fs::write(
        e.p(&format!(".claude/skills/{PIN}/SKILL.md")),
        format!("---\nname: {PIN}\ndescription: d\n---\n"),
    )
    .unwrap();
    assert_eq!(e.pin_of(PIN).name_clash, vec!["claude-code"]);
    // A warning only: the pin is still fine.
    assert_eq!(e.pin_of(PIN).state, PinState::Ok);

    e.shared(PIN, "d", "b\n");
    let clash = e.pin_of(PIN).name_clash;
    assert!(clash.contains(&"claude-code".to_string()));
    assert!(
        clash.contains(&"codex".to_string()),
        "agents reading the shared store: {clash:?}"
    );
}

#[test]
fn shared_changed_is_true_false_or_unknown() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    assert_eq!(e.pin_of(PIN).shared_changed, Some(false));
    // Whitespace-only differences in line endings don't count either.
    let md = e.p(&format!(".agents/skills/{QA}/SKILL.md"));
    fs::write(&md, read(&md).replace('\n', "\r\n")).unwrap();
    assert_eq!(e.pin_of(PIN).shared_changed, Some(false));
    fs::write(
        e.p(&format!(".agents/skills/{QA}/scripts/run.sh")),
        "echo changed\n",
    )
    .unwrap();
    assert_eq!(e.pin_of(PIN).shared_changed, Some(true));
    fs::remove_dir_all(e.p(&format!(".agents/skills/{QA}"))).unwrap();
    assert_eq!(e.pin_of(PIN).shared_changed, None);
    assert_eq!(e.pin_of(PIN).state, PinState::Ok, "informational only");
}

#[test]
fn skills_know_where_they_are_pinned() {
    let e = Env2::new();
    let mut q = e.q();
    e.pin(PinMode::Copy);
    let find = |inv: &Inventory| {
        inv.skills
            .iter()
            .find(|s| s.id == QA)
            .unwrap()
            .pinned_in
            .clone()
    };
    assert!(
        find(&q.scan()).is_empty(),
        "an unregistered project isn't looked at"
    );

    let s = q.project_add(&e.project()).unwrap();
    assert_eq!((s.pin_count, s.problem_count), (1, 0));
    let refs = find(&q.scan());
    assert_eq!(refs.len(), 1);
    assert_eq!(refs[0].project, e.project());
    assert_eq!(refs[0].project_name, "repo");
    assert_eq!(refs[0].pin, PIN);
    assert_eq!(refs[0].state, PinState::Ok);

    fs::write(e.r(&format!(".agents/skills/{PIN}/x.md")), "x").unwrap();
    assert_eq!(find(&q.scan())[0].state, PinState::Modified);

    // The pinned copy is not a skill of its own in the inventory (it lives in the repo).
    assert!(q.scan().skills.iter().all(|s| s.id != PIN));

    // A project that vanished is skipped, not an error.
    fs::remove_dir_all(&e.repo).unwrap();
    assert!(find(&q.scan()).is_empty());
    assert!(!q.projects_list()[0].exists);
}

#[test]
fn projects_are_registered_deduplicated_and_forgotten_without_touching_files() {
    let e = Env2::new();
    let mut q = e.q();
    fs::create_dir_all(e.r("packages/app")).unwrap();
    // A subfolder registers its git root; adding twice changes nothing.
    let s = q
        .project_add(&e.r("packages/app").to_string_lossy())
        .unwrap();
    assert_eq!(PathBuf::from(&s.path), e.repo);
    assert_eq!(s.name, "repo");
    assert_eq!((s.pin_count, s.problem_count), (0, 0));
    q.project_add(&e.project()).unwrap();
    assert_eq!(q.settings.projects, vec![e.project()]);
    assert_eq!(e.q().settings.projects, vec![e.project()], "persisted");
    assert!(
        s.display_path.starts_with('/') || s.display_path.contains(':'),
        "outside the home: shown in full"
    );

    // A folder that isn't there can't be added.
    assert!(q.project_add(&e.r("nope").to_string_lossy()).is_err());

    e.pin(PinMode::Copy);
    let list = q.projects_list();
    assert_eq!(list.len(), 1);
    assert_eq!((list[0].pin_count, list[0].problem_count), (1, 0));
    fs::write(e.r(&format!(".agents/skills/{PIN}/x.md")), "x").unwrap();
    assert_eq!(q.projects_list()[0].problem_count, 1);

    q.project_remove(&e.project()).unwrap();
    assert!(q.settings.projects.is_empty() && e.q().settings.projects.is_empty());
    assert!(e.r(LOCK_FILE).is_file() && e.r(&format!(".agents/skills/{PIN}")).is_dir());
    q.project_remove(&e.project()).unwrap();
}

#[test]
fn project_detail_lists_other_skills_with_their_source() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let mk = |dir: &str, name: &str| {
        fs::create_dir_all(e.r(dir)).unwrap();
        fs::write(
            e.r(&format!("{dir}/SKILL.md")),
            format!("---\nname: {name}\ndescription: about {name}\n---\n"),
        )
        .unwrap();
    };
    mk(".agents/skills/foo", "foo");
    mk(".windsurf/skills/bar", "bar");
    fs::create_dir_all(e.r("skills/not-ours")).unwrap();
    fs::write(
        e.r("skills/not-ours/SKILL.md"),
        "---\nname: x\ndescription: d\n---\n",
    )
    .unwrap();
    fs::write(
        e.r("skills-lock.json"),
        r#"{"version":1,"skills":{"foo":{"source":"vercel-labs/agent-skills","sourceType":"github","computedHash":"x"}}}"#,
    )
    .unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink("../../.agents/skills/foo", e.r(".claude/skills/foo")).unwrap();

    let d = e.detail();
    let others: Vec<(&str, &str, Option<&str>)> = d
        .other_skills
        .iter()
        .map(|s| (s.name.as_str(), s.dir.as_str(), s.source.as_deref()))
        .collect();
    assert_eq!(
        others,
        vec![
            ("bar", ".windsurf/skills/bar", None),
            (
                "foo",
                ".agents/skills/foo",
                Some("vercel-labs/agent-skills")
            ),
        ],
        "pins and generic folders are left out; a link to another listed skill isn't repeated"
    );
    assert_eq!(d.other_skills[1].description, "about foo");
    assert_eq!(d.pins.len(), 1);
}

// ---------- Compare ----------

#[test]
fn comparing_a_pin_ignores_the_rewritten_frontmatter() {
    let e = Env2::new();
    // A wrapped description in the shared copy: the rewrite changes its formatting too.
    let s = e.p(&format!(".agents/skills/{QA}/SKILL.md"));
    fs::write(
        &s,
        format!("---\nname: {QA}\ndescription: >\n  Tests the\n  browser.\nlicense: MIT\n---\nBody one.\nBody two.\n"),
    )
    .unwrap();
    e.pin(PinMode::Copy);
    let q = e.q();

    let c = q.pin_compare(&e.project(), PIN).unwrap();
    assert_eq!(c.skill_id, QA);
    assert_eq!(c.versions.len(), 2);
    let (shared, pinned) = (&c.versions[0], &c.versions[1]);
    assert_eq!((shared.id.as_str(), pinned.id.as_str()), ("v1", "v2"));
    assert!(shared.shared && !pinned.shared);
    assert_eq!(shared.locations[0].kind, LocationKind::Canonical);
    assert_eq!(pinned.locations.len(), 1);
    assert_eq!(
        PathBuf::from(&pinned.locations[0].path),
        e.r(&format!(".agents/skills/{PIN}"))
    );
    assert_eq!(pinned.locations[0].kind, LocationKind::Directory);
    assert!(pinned.agent_ids.is_empty() && pinned.locations[0].agent_ids.is_empty());
    assert_ne!(shared.content_hash, pinned.content_hash);
    assert_eq!(c.suggested, Some(("v1".into(), "v2".into())));
    assert!(
        c.files.iter().all(|f| f.status == FileStatus::Same),
        "{:?}",
        c.files
    );
    assert_eq!(c.files[0].path, "SKILL.md");
    assert_eq!(c.upstream_source, None);

    // The raw bytes of SKILL.md do differ, but the diff sees none.
    let d = q
        .pin_compare_file(
            &e.project(),
            PIN,
            "SKILL.md",
            &shared.content_hash,
            &pinned.content_hash,
        )
        .unwrap();
    assert!(d.identical && d.blocks.is_empty());

    // A real edit shows, and only that.
    let pin_md = e.r(&format!(".agents/skills/{PIN}/SKILL.md"));
    fs::write(
        &pin_md,
        read(&pin_md).replace("Body two.", "Body 2, edited."),
    )
    .unwrap();
    let c = q.pin_compare(&e.project(), PIN).unwrap();
    let skill_md = c.files.iter().find(|f| f.path == "SKILL.md").unwrap();
    assert_eq!(skill_md.status, FileStatus::Changed);
    assert_eq!(
        c.files
            .iter()
            .filter(|f| f.status != FileStatus::Same)
            .count(),
        1
    );
    let d = q
        .pin_compare_file(
            &e.project(),
            PIN,
            "SKILL.md",
            &c.versions[0].content_hash,
            &c.versions[1].content_hash,
        )
        .unwrap();
    assert_eq!((d.added, d.removed), (1, 1), "{d:?}");
    let rows: Vec<&DiffRow> = d
        .blocks
        .iter()
        .flat_map(|b| &b.rows)
        .filter(|r| r.kind != RowKind::Equal)
        .collect();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].left.as_deref(), Some("Body two."));
    assert_eq!(rows[0].right.as_deref(), Some("Body 2, edited."));
    // Either way round.
    let swapped = q
        .pin_compare_file(
            &e.project(),
            PIN,
            "SKILL.md",
            &c.versions[1].content_hash,
            &c.versions[0].content_hash,
        )
        .unwrap();
    assert_eq!(
        swapped
            .blocks
            .iter()
            .flat_map(|b| &b.rows)
            .find(|r| r.kind != RowKind::Equal)
            .unwrap()
            .right
            .as_deref(),
        Some("Body two.")
    );
    assert!(c.versions[1].edited_since_install == Some(true));

    // A stale hash is refused.
    assert!(
        q.pin_compare_file(
            &e.project(),
            PIN,
            "SKILL.md",
            "sha:stale",
            &c.versions[1].content_hash
        )
        .is_err()
    );
}

#[test]
fn a_changed_description_upstream_still_shows_in_the_comparison() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    e.shared(QA, "Now with a new description.", "Original body.\n");
    let q = e.q();
    let c = q.pin_compare(&e.project(), PIN).unwrap();
    let skill_md = c.files.iter().find(|f| f.path == "SKILL.md").unwrap();
    assert_eq!(skill_md.status, FileStatus::Changed);
    let d = q
        .pin_compare_file(
            &e.project(),
            PIN,
            "SKILL.md",
            &c.versions[0].content_hash,
            &c.versions[1].content_hash,
        )
        .unwrap();
    let row = d
        .blocks
        .iter()
        .flat_map(|b| &b.rows)
        .find(|r| r.kind != RowKind::Equal)
        .unwrap();
    assert!(
        row.left
            .as_deref()
            .unwrap()
            .contains("Now with a new description.")
    );
    assert!(row.right.as_deref().unwrap().contains("Tests the browser."));
    assert!(
        !row.right.as_deref().unwrap().contains("Pinned copy"),
        "shown without the prefix"
    );
    // Nothing to compare with when the shared copy is gone.
    fs::remove_dir_all(e.p(&format!(".agents/skills/{QA}"))).unwrap();
    assert!(q.pin_compare(&e.project(), PIN).is_err());
}

// ---------- GitHub refs (a stand-in for the network) ----------

/// Files of a commit as (path in the repo, content).
type Files = Vec<(&'static str, &'static str)>;
/// (ref names, commit sha, files)
type Commit = (Vec<&'static str>, String, Files);

struct FakeGitHub {
    commits: Vec<Commit>,
}

const SHA_V1: &str = "1111111111111111111111111111111111111111";
const SHA_MAIN: &str = "2222222222222222222222222222222222222222";

impl FakeGitHub {
    fn new() -> Self {
        Self {
            commits: vec![
                (
                    vec!["v1.0.0", SHA_V1],
                    SHA_V1.into(),
                    vec![
                        (
                            "skills/browser-qa/SKILL.md",
                            "---\nname: browser-qa\ndescription: Old v1 description.\n---\nv1 body\n",
                        ),
                        ("skills/browser-qa/scripts/old.sh", "echo old\n"),
                        ("README.md", "not part of the skill\n"),
                    ],
                ),
                (
                    vec!["main"],
                    SHA_MAIN.into(),
                    vec![
                        (
                            "skills/browser-qa/SKILL.md",
                            "---\nname: browser-qa\ndescription: Newest.\n---\nmain body\n",
                        ),
                        (
                            "skills/other/SKILL.md",
                            "---\nname: other\ndescription: o\n---\n",
                        ),
                    ],
                ),
            ],
        }
    }
    fn commit(&self, sha: &str) -> anyhow::Result<&Commit> {
        self.commits
            .iter()
            .find(|c| c.1 == sha)
            .ok_or_else(|| anyhow::anyhow!("unknown commit {sha}"))
    }
}

impl PinRemote for FakeGitHub {
    fn resolve_commit(&self, repo: &str, git_ref: &str) -> anyhow::Result<String> {
        assert_eq!(repo, "owner/repo");
        self.commits
            .iter()
            .find(|c| c.0.contains(&git_ref))
            .map(|c| c.1.clone())
            .ok_or_else(|| anyhow::anyhow!("owner/repo@{git_ref} not found"))
    }
    fn tree(&self, repo: &str, commit: &str) -> anyhow::Result<Tree> {
        assert_eq!(repo, "owner/repo");
        assert_eq!(
            commit.len(),
            40,
            "ref resolved to a SHA before the tree is fetched"
        );
        let c = self.commit(commit)?;
        let mut tree = vec![];
        for (path, content) in &c.2 {
            tree.push(TreeEntry {
                path: path.to_string(),
                mode: "100644".into(),
                kind: "blob".into(),
                sha: "b".into(),
                size: Some(content.len() as u64),
            });
            if let Some((dir, _)) = path.rsplit_once('/') {
                let mut acc = String::new();
                for part in dir.split('/') {
                    if !acc.is_empty() {
                        acc.push('/');
                    }
                    acc.push_str(part);
                    if !tree.iter().any(|t: &TreeEntry| t.path == acc) {
                        tree.push(TreeEntry {
                            path: acc.clone(),
                            mode: "040000".into(),
                            kind: "tree".into(),
                            sha: "t".into(),
                            size: None,
                        });
                    }
                }
            }
        }
        Ok(Tree {
            sha: "root".into(),
            tree,
            truncated: false,
        })
    }
    fn download_folder(
        &self,
        repo: &str,
        commit: &str,
        _tree: &Tree,
        folder: &str,
        dest: &Path,
    ) -> anyhow::Result<()> {
        assert_eq!(repo, "owner/repo");
        let c = self.commit(commit)?;
        for (path, content) in &c.2 {
            if let Some(rel) = path.strip_prefix(&format!("{folder}/")) {
                let to = rel.split('/').fold(dest.to_path_buf(), |a, s| a.join(s));
                fs::create_dir_all(to.parent().unwrap()).unwrap();
                fs::write(to, content).unwrap();
            }
        }
        Ok(())
    }
}

#[test]
fn pinning_at_a_ref_records_the_commit_and_downloads_that_version() {
    let e = Env2::new();
    e.global_lock();
    let gh = FakeGitHub::new();
    let mut req = e.request(PIN, PinMode::Copy);
    req.git_ref = Some("v1.0.0".into());
    let d = e.q().pin_create_with(&req, &gh).unwrap();
    let pin = &d.pins[0];
    assert_eq!(pin.pinned_from, PinnedFrom::Github);
    assert_eq!(
        pin.git_ref.as_deref(),
        Some(SHA_V1),
        "the tag is resolved to a commit"
    );
    assert_eq!(
        pin.source.as_ref().unwrap().git_ref.as_deref(),
        Some(SHA_V1)
    );
    assert_eq!(pin.state, PinState::Ok);
    assert_eq!(pin.description, "Old v1 description.");
    let dir = e.r(&format!(".agents/skills/{PIN}"));
    assert!(read(&dir.join("SKILL.md")).contains("v1 body"));
    assert!(read(&dir.join("SKILL.md")).contains(&format!("name: {PIN}")));
    assert_eq!(read(&dir.join("scripts/old.sh")), "echo old\n");
    assert!(!dir.join("README.md").exists(), "only the skill's folder");
    // The shared copy has moved on from the pinned version.
    assert_eq!(pin.shared_changed, Some(true));
    let v: serde_json::Value = serde_json::from_str(&e.lock_text()).unwrap();
    assert_eq!(v["pins"][PIN]["gitRef"], SHA_V1);
    assert_eq!(v["pins"][PIN]["pinnedFrom"], "github");

    // Move to another ref, then back to the shared copy.
    let d = e
        .q()
        .pin_update_with(&e.project(), PIN, Some("main"), &gh)
        .unwrap();
    assert_eq!(d.pins[0].git_ref.as_deref(), Some(SHA_MAIN));
    assert!(read(&dir.join("SKILL.md")).contains("main body"));
    assert!(!dir.join("scripts/old.sh").exists());
    assert_eq!(d.pins[0].state, PinState::Ok);
    assert!(read(&e.r(&format!(".claude/skills/{PIN}/SKILL.md"))).contains("main body"));

    let d = e.q().pin_update_with(&e.project(), PIN, None, &gh).unwrap();
    assert_eq!(d.pins[0].pinned_from, PinnedFrom::Shared);
    assert_eq!(d.pins[0].git_ref, None);
    assert!(read(&dir.join("SKILL.md")).contains("Original body."));

    // A full SHA works as well.
    let d = e
        .q()
        .pin_update_with(&e.project(), PIN, Some(SHA_V1), &gh)
        .unwrap();
    assert_eq!(d.pins[0].git_ref.as_deref(), Some(SHA_V1));
}

#[test]
fn pinning_at_a_ref_fails_cleanly() {
    let e = Env2::new();
    let gh = FakeGitHub::new();
    let mut req = e.request(PIN, PinMode::Copy);
    req.git_ref = Some("v1.0.0".into());
    // No GitHub source recorded for this skill.
    let err = format!("{:#}", e.q().pin_create_with(&req, &gh).unwrap_err());
    assert!(err.contains("no GitHub source"), "{err}");
    assert!(!e.r(".agents").exists());

    e.global_lock();
    req.git_ref = Some("v9.9.9".into());
    let err = format!("{:#}", e.q().pin_create_with(&req, &gh).unwrap_err());
    assert!(err.contains("not found"), "{err}");
    assert!(!e.r(".agents").exists(), "nothing left behind");
    assert!(!e.r(LOCK_FILE).exists());

    // A skill that doesn't exist at that commit.
    let mut gh2 = FakeGitHub::new();
    gh2.commits[0]
        .2
        .retain(|f| !f.0.starts_with("skills/browser-qa"));
    gh2.commits[0].2.push((
        "skills/else/SKILL.md",
        "---\nname: else\ndescription: d\n---\n",
    ));
    gh2.commits[0].2.push((
        "skills/else2/SKILL.md",
        "---\nname: else\ndescription: d\n---\n",
    ));
    req.git_ref = Some("v1.0.0".into());
    let err = format!("{:#}", e.q().pin_create_with(&req, &gh2).unwrap_err());
    assert!(err.contains("doesn't exist"), "{err}");
    assert!(!e.r(".agents").exists());
}

#[test]
fn creating_a_pin_without_a_ref_never_uses_the_network() {
    struct Forbidden;
    impl PinRemote for Forbidden {
        fn resolve_commit(&self, _: &str, _: &str) -> anyhow::Result<String> {
            panic!("network used")
        }
        fn tree(&self, _: &str, _: &str) -> anyhow::Result<Tree> {
            panic!("network used")
        }
        fn download_folder(
            &self,
            _: &str,
            _: &str,
            _: &Tree,
            _: &str,
            _: &Path,
        ) -> anyhow::Result<()> {
            panic!("network used")
        }
    }
    let e = Env2::new();
    e.global_lock();
    let q = e.q();
    q.pin_create_with(&e.request(PIN, PinMode::Copy), &Forbidden)
        .unwrap();
    q.pin_update_with(&e.project(), PIN, None, &Forbidden)
        .unwrap();
}

#[test]
fn the_lock_is_byte_stable_across_reads() {
    let e = Env2::new();
    e.pin(PinMode::Copy);
    let before = fs::read(e.r(LOCK_FILE)).unwrap();
    let q = e.q();
    q.project_detail(&e.project()).unwrap();
    q.pin_sync(&e.project()).unwrap();
    q.pin_compare(&e.project(), PIN).unwrap();
    assert_eq!(fs::read(e.r(LOCK_FILE)).unwrap(), before);
}

fn keys(v: &serde_json::Value) -> Vec<String> {
    let mut k: Vec<String> = v.as_object().unwrap().keys().cloned().collect();
    k.sort();
    k
}

#[test]
fn json_matches_the_typescript_contract() {
    let e = Env2::new();
    e.global_lock();
    let mut q = e.q();
    let d = e.pin(PinMode::Copy);
    q.project_add(&e.project()).unwrap();

    let v = serde_json::to_value(&d).unwrap();
    assert_eq!(
        keys(&v),
        [
            "branch",
            "displayPath",
            "exists",
            "isRepo",
            "lockFile",
            "name",
            "otherSkills",
            "path",
            "pinCount",
            "pins",
            "problemCount"
        ],
        "ProjectDetail is flat: the summary fields and pins, otherSkills, lockFile"
    );
    let pin = &v["pins"][0];
    assert_eq!(
        keys(pin),
        [
            "agents",
            "changedFiles",
            "description",
            "gitRef",
            "hash",
            "mode",
            "name",
            "nameClash",
            "path",
            "pinnedAt",
            "pinnedFrom",
            "problems",
            "sharedChanged",
            "skill",
            "source",
            "state",
            "upstreamHash"
        ]
    );
    assert_eq!(pin["state"], "ok");
    assert_eq!(pin["mode"], "copy");
    assert_eq!(pin["pinnedFrom"], "shared");
    assert_eq!(
        keys(&pin["agents"][0]),
        ["agentId", "dir", "kind", "ok", "problem"]
    );
    assert_eq!(pin["agents"][0]["kind"], "copy");
    assert_eq!(pin["agents"][1]["kind"], "native");
    assert_eq!(
        keys(&pin["source"]),
        [
            "gitRef",
            "installedAt",
            "kind",
            "skillPath",
            "source",
            "updatedAt",
            "url"
        ]
    );

    let skill = serde_json::to_value(q.scan().skills.iter().find(|s| s.id == QA).unwrap()).unwrap();
    assert_eq!(
        keys(&skill["pinnedIn"][0]),
        ["pin", "project", "projectName", "state"]
    );
    let inv = serde_json::to_value(q.scan()).unwrap();
    assert!(inv["agents"][0].get("projectDir").is_some());
    let settings = serde_json::to_value(q.settings_view()).unwrap();
    assert_eq!(settings["projects"], serde_json::json!([e.project()]));

    // PinRequest accepts exactly what the UI sends.
    let req: PinRequest = serde_json::from_value(serde_json::json!({
        "project": "/p", "skill": "s", "name": "n", "gitRef": null, "agents": [], "mode": "symlink"
    }))
    .unwrap();
    assert_eq!(req.mode, PinMode::Symlink);
    assert_eq!(req.git_ref, None);
}
