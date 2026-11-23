//! End-to-end tests against a fake home directory with several agents.

use quiver_core::fsutil::{self, Entry, entry};
use quiver_core::*;
use std::fs;
use std::path::{Path, PathBuf};

struct Home {
    _dir: tempfile::TempDir,
    root: PathBuf,
}

impl Home {
    fn new() -> Self {
        // SAFETY: tests in this file all want the same value; set before any threads read it.
        unsafe { std::env::set_var("QUIVER_NO_TRASH", "1") };
        let dir = tempfile::tempdir().unwrap();
        // Canonical form without the `\\?\` prefix Windows' own canonicalize adds.
        let root = fsutil::canonicalize(dir.path()).unwrap();
        for d in [
            ".claude/skills",
            ".codex",
            ".gemini/config",
            ".cursor/skills",
            ".agents/skills",
        ] {
            fs::create_dir_all(root.join(d)).unwrap();
        }
        Self { _dir: dir, root }
    }
    fn q(&self) -> Quiver {
        Quiver::with_env(Env::isolated(&self.root))
    }
    /// `rel` is written with `/`; the result uses the platform's separators so it
    /// compares equal to paths the scanner produces.
    fn p(&self, rel: &str) -> PathBuf {
        rel.split('/')
            .fold(self.root.clone(), |acc, part| acc.join(part))
    }
    fn skill(&self, rel: &str, name: &str, body: &str) {
        let d = self.p(rel);
        fs::create_dir_all(&d).unwrap();
        fs::write(
            d.join("SKILL.md"),
            format!("---\nname: {name}\ndescription: {name} skill\n---\n{body}\n"),
        )
        .unwrap();
    }
}

fn presence(inv: &Inventory, id: &str, agent: &str) -> Presence {
    let s = inv
        .skills
        .iter()
        .find(|s| s.id == id)
        .unwrap_or_else(|| panic!("no skill {id}"));
    s.presence
        .iter()
        .find(|p| p.agent_id == agent)
        .unwrap()
        .presence
}

fn is_link(p: &Path) -> bool {
    matches!(entry(p), Entry::Link { resolves: true, .. })
}

/// A directory link with an absolute target: a symlink on Unix, a junction on
/// Windows. The target need not exist (that makes a broken link).
fn link(target: PathBuf, at: PathBuf) {
    fsutil::symlink_dir_abs(&target, &at).unwrap();
}

fn git_available() -> bool {
    std::process::Command::new("git")
        .arg("--version")
        .output()
        .is_ok_and(|o| o.status.success())
}

#[test]
fn scan_classifies_everything() {
    let h = Home::new();
    h.skill(".agents/skills/shared", "shared", "v1");
    h.skill(".claude/skills/only-claude", "only-claude", "c");
    h.skill(".gemini/config/skills/dup", "dup", "A");
    h.skill(".cursor/skills/dup", "dup", "B");
    h.skill(".codex/skills/legacy", "legacy", "x");
    link(h.p("nowhere"), h.p(".claude/skills/ghost"));
    quiver_core::fsutil::symlink_dir(&h.p(".agents/skills/shared"), &h.p(".claude/skills/shared"))
        .unwrap();

    let inv = h.q().scan();
    assert_eq!(presence(&inv, "shared", "codex"), Presence::Native);
    assert_eq!(presence(&inv, "shared", "claude-code"), Presence::Linked);
    assert_eq!(presence(&inv, "shared", "cursor"), Presence::Absent);
    assert_eq!(
        presence(&inv, "only-claude", "claude-code"),
        Presence::Local
    );
    assert_eq!(presence(&inv, "legacy", "codex"), Presence::Local);
    assert_eq!(presence(&inv, "ghost", "claude-code"), Presence::Broken);
    let dup = inv.skills.iter().find(|s| s.id == "dup").unwrap();
    assert!(dup.issues.iter().any(|i| i.kind == IssueKind::Conflict));
    assert!(!dup.managed);
    let claude = inv.agents.iter().find(|a| a.id == "claude-code").unwrap();
    assert!(claude.detected);
    assert_eq!(
        claude.skill_count, 2,
        "shared + only-claude (broken not counted)"
    );
}

#[test]
fn adopt_moves_into_store_and_links_everywhere() {
    let h = Home::new();
    h.skill(".claude/skills/writer", "writer", "draft");
    let q = h.q();
    q.adopt("writer", None).unwrap();

    assert!(matches!(entry(&h.p(".agents/skills/writer")), Entry::Dir));
    assert!(is_link(&h.p(".claude/skills/writer")));
    assert!(is_link(&h.p(".gemini/config/skills/writer")));
    assert!(is_link(&h.p(".cursor/skills/writer")));
    let inv = q.scan();
    for a in ["claude-code", "antigravity", "cursor"] {
        assert_eq!(presence(&inv, "writer", a), Presence::Linked, "{a}");
    }
    assert_eq!(presence(&inv, "writer", "codex"), Presence::Native);
    assert!(
        inv.skills
            .iter()
            .find(|s| s.id == "writer")
            .unwrap()
            .issues
            .iter()
            .all(|i| i.severity == "info" || i.kind != IssueKind::Unmanaged)
    );
    // Content survived the move.
    assert!(
        fs::read_to_string(h.p(".claude/skills/writer/SKILL.md"))
            .unwrap()
            .contains("draft")
    );
}

#[test]
fn adopt_replaces_identical_copies_but_refuses_conflicts() {
    let h = Home::new();
    h.skill(".claude/skills/same", "same", "x");
    h.skill(".cursor/skills/same", "same", "x");
    h.skill(".claude/skills/diff", "diff", "A");
    h.skill(".cursor/skills/diff", "diff", "B");
    let q = h.q();
    q.adopt("same", None).unwrap();
    assert!(is_link(&h.p(".claude/skills/same")) && is_link(&h.p(".cursor/skills/same")));

    let err = q.adopt("diff", None).unwrap_err().to_string();
    assert!(err.contains("different versions"), "{err}");
    // Resolve by picking cursor's copy: claude's goes away, both become links.
    q.adopt("diff", Some(&h.p(".cursor/skills/diff"))).unwrap();
    assert!(
        fs::read_to_string(h.p(".agents/skills/diff/SKILL.md"))
            .unwrap()
            .contains('B')
    );
    assert!(is_link(&h.p(".claude/skills/diff")));
    assert!(
        fs::read_to_string(h.p(".claude/skills/diff/SKILL.md"))
            .unwrap()
            .contains('B')
    );
    let inv = q.scan();
    assert!(
        !inv.skills
            .iter()
            .find(|s| s.id == "diff")
            .unwrap()
            .issues
            .iter()
            .any(|i| i.kind == IssueKind::Conflict)
    );
}

#[test]
fn adopt_flips_canonical_link_into_agent_dir() {
    // ~/.agents/skills/x -> ~/.claude/skills/x (real), as hand-made setups often do.
    let h = Home::new();
    h.skill(".claude/skills/flip", "flip", "body");
    link(h.p(".claude/skills/flip"), h.p(".agents/skills/flip"));
    let q = h.q();
    let inv = q.scan();
    assert_eq!(presence(&inv, "flip", "claude-code"), Presence::Linked);
    q.adopt("flip", None).unwrap();
    assert!(matches!(entry(&h.p(".agents/skills/flip")), Entry::Dir));
    assert!(is_link(&h.p(".claude/skills/flip")));
}

#[test]
fn foreign_link_source_stays_live() {
    let h = Home::new();
    h.skill("dev/my-skill", "my-skill", "wip");
    link(h.p("dev/my-skill"), h.p(".claude/skills/my-skill"));
    let q = h.q();
    q.adopt("my-skill", None).unwrap();
    // Canonical links to the dev folder instead of copying it.
    assert!(is_link(&h.p(".agents/skills/my-skill")));
    assert!(h.p("dev/my-skill/SKILL.md").exists());
    let inv = q.scan();
    assert_eq!(presence(&inv, "my-skill", "claude-code"), Presence::Linked);
    assert_eq!(
        inv.skills
            .iter()
            .find(|s| s.id == "my-skill")
            .unwrap()
            .source
            .as_ref()
            .unwrap()
            .kind,
        "local"
    );
    // Removing never touches the dev folder.
    q.remove("my-skill").unwrap();
    assert!(h.p("dev/my-skill/SKILL.md").exists());
    assert!(matches!(
        entry(&h.p(".claude/skills/my-skill")),
        Entry::Missing
    ));
}

#[test]
fn unlink_records_exclusion_and_sync_respects_it() {
    let h = Home::new();
    h.skill(".agents/skills/tool", "tool", "t");
    let q = h.q();
    let plan = q.sync_plan();
    assert!(plan.links.contains(&("tool".into(), "cursor".into())));
    q.sync_apply(true, true, true);
    assert!(is_link(&h.p(".cursor/skills/tool")));

    q.set_link("tool", "cursor", false).unwrap();
    assert!(matches!(entry(&h.p(".cursor/skills/tool")), Entry::Missing));
    assert!(
        !q.sync_plan()
            .links
            .iter()
            .any(|(s, a)| s == "tool" && a == "cursor")
    );
    // Codex reads the store natively: can't be unlinked.
    assert!(q.set_link("tool", "codex", false).is_err());
    q.set_link("tool", "cursor", true).unwrap();
    assert!(is_link(&h.p(".cursor/skills/tool")));
}

#[test]
fn set_link_on_unmanaged_adopts_first() {
    let h = Home::new();
    h.skill(".claude/skills/solo", "solo", "s");
    let q = h.q();
    q.set_link("solo", "cursor", true).unwrap();
    assert!(matches!(entry(&h.p(".agents/skills/solo")), Entry::Dir));
    assert!(is_link(&h.p(".cursor/skills/solo")));
    assert!(is_link(&h.p(".claude/skills/solo")));
}

#[test]
fn sync_prunes_broken_links_and_adopts() {
    let h = Home::new();
    link(h.p("gone"), h.p(".cursor/skills/gone"));
    h.skill(".gemini/config/skills/ag", "ag", "a");
    let q = h.q();
    let plan = q.sync_plan();
    assert_eq!(
        plan.prune,
        vec![h.p(".cursor/skills/gone").to_string_lossy().into_owned()]
    );
    assert_eq!(plan.adopt, vec!["ag".to_string()]);
    let r = q.sync_apply(true, true, true);
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert!(matches!(entry(&h.p(".cursor/skills/gone")), Entry::Missing));
    assert!(is_link(&h.p(".claude/skills/ag")));
    let plan = q.sync_plan();
    assert!(
        plan.links.is_empty() && plan.adopt.is_empty() && plan.prune.is_empty(),
        "{plan:?}"
    );
}

#[test]
fn copy_mode_agents_get_real_copies() {
    let h = Home::new();
    h.skill(".agents/skills/cp", "cp", "1");
    let mut q = h.q();
    let mut s = q.settings.clone();
    s.link_modes.insert("cursor".into(), LinkMode::Copy);
    q.save_settings(s).unwrap();
    q.set_link("cp", "cursor", true).unwrap();
    assert!(matches!(entry(&h.p(".cursor/skills/cp")), Entry::Dir));
    assert_eq!(presence(&q.scan(), "cp", "cursor"), Presence::Copied);
}

#[test]
fn install_from_local_folder_and_update() {
    let h = Home::new();
    h.skill("src/pack/skills/alpha", "alpha", "v1");
    h.skill("src/pack/skills/beta", "beta", "v1");
    let q = h.q();
    let session = q.resolve(h.p("src/pack").to_str().unwrap()).unwrap();
    assert_eq!(session.resolved.kind, "local");
    let paths: Vec<String> = session
        .resolved
        .candidates
        .iter()
        .map(|c| c.path.clone())
        .collect();
    assert_eq!(paths, vec!["skills/alpha", "skills/beta"]);
    let r = q.install(&session, &paths, &[], false);
    assert_eq!(r.ok, vec!["alpha", "beta"], "{r:?}");
    assert!(is_link(&h.p(".claude/skills/alpha")));
    // Second install without overwrite is skipped.
    let r = q.install(&session, &paths[..1], &[], false);
    assert_eq!(r.skipped.len(), 1);

    let u = q.check_updates(true);
    assert!(
        u.iter().all(|i| i.status == UpdateStatus::UpToDate),
        "{u:?}"
    );
    fs::write(
        h.p("src/pack/skills/alpha/SKILL.md"),
        "---\nname: alpha\ndescription: alpha skill\n---\nv2\n",
    )
    .unwrap();
    let u = q.check_updates(true);
    assert_eq!(
        u.iter().find(|i| i.id == "alpha").unwrap().status,
        UpdateStatus::Available
    );

    // Local edit blocks the update unless forced.
    fs::write(h.p(".agents/skills/alpha/notes.md"), "mine").unwrap();
    let r = q.update(&["alpha".into()], false);
    assert_eq!(r.skipped.len(), 1, "{r:?}");
    let r = q.update(&["alpha".into()], true);
    assert_eq!(r.ok, vec!["alpha"], "{r:?}");
    assert!(
        fs::read_to_string(h.p(".agents/skills/alpha/SKILL.md"))
            .unwrap()
            .contains("v2")
    );
    assert!(!h.p(".agents/skills/alpha/notes.md").exists());
    assert!(is_link(&h.p(".claude/skills/alpha")));
    let u = q.check_updates(true);
    assert_eq!(
        u.iter().find(|i| i.id == "alpha").unwrap().status,
        UpdateStatus::UpToDate
    );
}

#[test]
fn create_and_remove() {
    let h = Home::new();
    let q = h.q();
    assert!(q.create("Bad Name", "").is_err());
    q.create("new-skill", "Does a thing").unwrap();
    assert!(is_link(&h.p(".cursor/skills/new-skill")));
    let d = q.detail("new-skill").unwrap();
    assert_eq!(d.skill.description, "Does a thing");
    assert!(d.skill.issues.is_empty(), "{:?}", d.skill.issues);
    assert!(q.read_file("new-skill", "../../etc/passwd").is_err());
    assert!(
        q.read_file("new-skill", "SKILL.md")
            .unwrap()
            .contains("Does a thing")
    );
    q.remove("new-skill").unwrap();
    assert!(matches!(
        entry(&h.p(".cursor/skills/new-skill")),
        Entry::Missing
    ));
    assert!(matches!(
        entry(&h.p(".agents/skills/new-skill")),
        Entry::Missing
    ));
    // Recoverable: it went to the backup trash.
    assert!(fs::read_dir(h.p(".quiver/trash")).unwrap().next().is_some());
}

#[test]
fn hidden_agents_are_not_linked() {
    let h = Home::new();
    let mut q = h.q();
    let mut s = q.settings.clone();
    s.hidden_agents.push("cursor".into());
    q.save_settings(s).unwrap();
    q.create("hid", "x").unwrap();
    assert!(matches!(entry(&h.p(".cursor/skills/hid")), Entry::Missing));
    assert!(is_link(&h.p(".claude/skills/hid")));
}

#[test]
fn universal_mode_keeps_everything_everywhere() {
    let h = Home::new();
    let mut q = h.q();
    // Off by default: nothing happens on its own.
    h.skill(".claude/skills/early", "early", "e");
    assert!(q.auto_sync().is_none());
    assert!(matches!(
        entry(&h.p(".cursor/skills/early")),
        Entry::Missing
    ));

    let mut s = q.settings.clone();
    s.universal = true;
    q.save_settings(s).unwrap();
    let r = q.auto_sync().expect("work to do");
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    assert!(is_link(&h.p(".cursor/skills/early")));
    assert!(is_link(&h.p(".gemini/config/skills/early")));
    // In sync now: nothing more to do.
    assert!(q.auto_sync().is_none());

    // A skill dropped into one agent's folder spreads to all of them.
    h.skill(".gemini/config/skills/dropped", "dropped", "d");
    q.auto_sync().unwrap();
    assert!(is_link(&h.p(".claude/skills/dropped")));
    assert!(is_link(&h.p(".cursor/skills/dropped")));

    // An explicit exception is respected.
    q.set_link("dropped", "cursor", false).unwrap();
    assert!(q.auto_sync().is_none());
    assert!(matches!(
        entry(&h.p(".cursor/skills/dropped")),
        Entry::Missing
    ));
}

#[test]
fn my_skills_live_in_their_own_folder() {
    let h = Home::new();
    let q = h.q();
    q.create("my-tool", "Does my thing").unwrap();
    // Source of truth is ~/Skills, a git repo when git exists; the store links to it.
    assert!(h.p("Skills/my-tool/SKILL.md").is_file());
    assert!(is_link(&h.p(".agents/skills/my-tool")));
    assert!(is_link(&h.p(".claude/skills/my-tool")));
    let inv = q.scan();
    let s = inv.skills.iter().find(|s| s.id == "my-tool").unwrap();
    assert_eq!(s.origin, Origin::Mine);
    assert_eq!(s.source.as_ref().unwrap().kind, "mine");
    assert_eq!(presence(&inv, "my-tool", "codex"), Presence::Native);
    // Never offered as an update target.
    assert!(q.check_updates(true).iter().all(|u| u.id != "my-tool"));

    // Dropping a folder into ~/Skills registers it on the next sync.
    h.skill("Skills/dropped", "dropped", "d");
    assert_eq!(q.sync_plan().register, vec!["dropped".to_string()]);
    let r = q.auto_sync().expect("registers");
    assert!(r.ok.iter().any(|x| x == "register:dropped"), "{:?}", r.ok);
    assert!(is_link(&h.p(".agents/skills/dropped")));

    // Removing a skill of mine removes its folder too (recoverably).
    q.remove("my-tool").unwrap();
    assert!(!h.p("Skills/my-tool").exists());
    assert!(matches!(
        entry(&h.p(".agents/skills/my-tool")),
        Entry::Missing
    ));
    assert!(q.sync_plan().register.is_empty());
}

#[test]
fn make_mine_forks_an_installed_skill() {
    let h = Home::new();
    h.skill(".agents/skills/pdf", "pdf", "upstream");
    fs::write(
        h.p(".agents/.skill-lock.json"),
        r#"{"version":3,"skills":{"pdf":{"source":"anthropics/skills","sourceType":"github","skillFolderHash":"abc"}}}"#,
    )
    .unwrap();
    quiver_core::fsutil::symlink_dir(&h.p(".agents/skills/pdf"), &h.p(".claude/skills/pdf"))
        .unwrap();
    h.skill(".cursor/skills/solo", "solo", "only cursor");
    let q = h.q();
    let before = q.scan();
    assert_eq!(
        before.skills.iter().find(|s| s.id == "pdf").unwrap().origin,
        Origin::Installed
    );

    q.make_mine("pdf").unwrap();
    assert!(h.p("Skills/pdf/SKILL.md").is_file());
    assert!(is_link(&h.p(".agents/skills/pdf")));
    // Existing agent links keep working through the store.
    assert!(h.p(".claude/skills/pdf/SKILL.md").is_file());
    let inv = q.scan();
    let s = inv.skills.iter().find(|s| s.id == "pdf").unwrap();
    assert_eq!(s.origin, Origin::Mine);
    assert_eq!(s.forked_from.as_deref(), Some("anthropics/skills"));
    let lock = fs::read_to_string(h.p(".agents/.skill-lock.json")).unwrap();
    assert!(!lock.contains("\"pdf\""), "upstream tracking dropped");

    // Unmanaged skills can be made mine directly.
    q.make_mine("solo").unwrap();
    assert!(h.p("Skills/solo/SKILL.md").is_file());
    let inv = q.scan();
    assert_eq!(
        inv.skills.iter().find(|s| s.id == "solo").unwrap().origin,
        Origin::Mine
    );
    assert_eq!(presence(&inv, "solo", "cursor"), Presence::Linked);
}

#[test]
fn my_skills_git_workflow() {
    if !git_available() {
        return;
    }
    let h = Home::new();
    let q = h.q();
    let st = q.my_skills_init().unwrap();
    assert!(st.is_repo, "{st:?}");
    q.create("alpha", "first").unwrap();
    let st = q.my_skills_status();
    assert!(
        st.changes
            .iter()
            .any(|c| c.skill_id.as_deref() == Some("alpha"))
    );
    let inv = q.scan();
    assert!(
        inv.skills
            .iter()
            .find(|s| s.id == "alpha")
            .unwrap()
            .git_changes
            .unwrap()
            >= 1
    );
    let hash = q.my_skills_commit("Add alpha", &[]).unwrap();
    assert!(!hash.is_empty());
    let st = q.my_skills_status();
    assert!(st.changes.is_empty(), "{:?}", st.changes);
    assert_eq!(st.last_commit.unwrap().subject, "Add alpha");
    assert!(q.my_skills_commit("again", &[]).is_err());
}

#[test]
fn my_skills_folder_cannot_overlap_agent_folders() {
    let h = Home::new();
    h.skill(".agents/skills/shared", "shared", "v1");
    let mut q = h.q();
    for bad in ["~/.agents/skills", "~/.claude/skills", "~", "~/.agents"] {
        let mut s = q.settings.clone();
        s.my_skills_dir = bad.into();
        q.save_settings(s).unwrap();
        assert!(q.my_dir_problem().is_some(), "{bad}");
        assert!(q.create("nope", "x").is_err(), "{bad}");
        let inv = q.scan();
        assert!(inv.skills.iter().all(|s| s.origin != Origin::Mine), "{bad}");
        assert!(q.sync_plan().register.is_empty());
    }
}

#[test]
fn only_enabled_claude_plugins_count() {
    let h = Home::new();
    for p in ["on", "off"] {
        h.skill(
            &format!("plugcache/{p}/skills/{p}-skill"),
            &format!("{p}-skill"),
            "p",
        );
    }
    // serde_json escapes Windows backslashes in the paths.
    let install = |p: &str| serde_json::json!([{"scope": "user", "installPath": h.p(&format!("plugcache/{p}"))}]);
    let manifest = serde_json::json!({
        "version": 2,
        "plugins": {"on@market": install("on"), "off@market": install("off")}
    })
    .to_string();
    fs::create_dir_all(h.p(".claude/plugins")).unwrap();
    fs::write(h.p(".claude/plugins/installed_plugins.json"), manifest).unwrap();
    fs::write(
        h.p(".claude/settings.json"),
        r#"{"enabledPlugins":{"on@market":true,"off@market":false}}"#,
    )
    .unwrap();
    let inv = h.q().scan();
    let plugins: Vec<&str> = inv
        .skills
        .iter()
        .filter(|s| s.origin == Origin::Plugin)
        .map(|s| s.id.as_str())
        .collect();
    assert_eq!(plugins, vec!["on:on-skill"]);
}
