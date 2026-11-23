//! Windows links skills three ways: junctions (default), real symlinks, or, when
//! neither is possible, plain copies. Whichever is used, scan, sync, unlink and
//! remove must give the same answers. On Unix the one strategy is the symlink.
//!
//! A single `#[test]` on purpose: it flips a process-wide environment variable.

use quiver_core::fsutil::{self, Entry, entry};
use quiver_core::*;
use std::fs;
use std::path::PathBuf;

struct Home {
    _dir: tempfile::TempDir,
    root: PathBuf,
}

fn home() -> Home {
    let dir = tempfile::tempdir().unwrap();
    let root = fsutil::canonicalize(dir.path()).unwrap();
    for d in [".claude/skills", ".cursor/skills", ".agents/skills"] {
        fs::create_dir_all(root.join(d)).unwrap();
    }
    Home { _dir: dir, root }
}

fn presence(inv: &Inventory, id: &str, agent: &str) -> Presence {
    inv.skills
        .iter()
        .find(|s| s.id == id)
        .unwrap_or_else(|| panic!("no skill {id}"))
        .presence
        .iter()
        .find(|p| p.agent_id == agent)
        .unwrap()
        .presence
}

fn write_skill(dir: &std::path::Path, name: &str) {
    fs::create_dir_all(dir).unwrap();
    fs::write(
        dir.join("SKILL.md"),
        format!("---\nname: {name}\ndescription: {name} skill\n---\nbody\n"),
    )
    .unwrap();
}

/// Links in effect (junction or symlink): the full lifecycle.
fn linked_lifecycle(label: &str) {
    let h = home();
    let q = Quiver::with_env(Env::isolated(&h.root));
    q.create("alpha", "first skill").unwrap();

    for agent in [".claude/skills/alpha", ".cursor/skills/alpha"] {
        let p = h.root.join(agent);
        assert!(
            matches!(entry(&p), Entry::Link { resolves: true, .. }),
            "[{label}] {agent} should be a live link, got {:?}",
            entry(&p)
        );
        assert!(
            p.join("SKILL.md").is_file(),
            "[{label}] reads through {agent}"
        );
    }
    // The store entry is a link into My Skills, which holds the only real folder.
    assert!(matches!(
        entry(&h.root.join(".agents/skills/alpha")),
        Entry::Link { resolves: true, .. }
    ));
    assert!(h.root.join("Skills/alpha/SKILL.md").is_file());

    let inv = q.scan();
    assert_eq!(
        presence(&inv, "alpha", "claude-code"),
        Presence::Linked,
        "[{label}]"
    );
    assert_eq!(
        presence(&inv, "alpha", "cursor"),
        Presence::Linked,
        "[{label}]"
    );
    assert_eq!(
        presence(&inv, "alpha", "codex"),
        Presence::Native,
        "[{label}]"
    );
    let alpha = inv.skills.iter().find(|s| s.id == "alpha").unwrap();
    assert!(
        alpha.issues.is_empty(),
        "[{label}] healthy skill has no issues: {:?}",
        alpha.issues
    );
    assert_eq!(alpha.origin, Origin::Mine, "[{label}]");
    // Editing the one real folder is visible through every agent's link.
    fs::write(h.root.join("Skills/alpha/extra.md"), "more").unwrap();
    assert_eq!(
        fs::read_to_string(h.root.join(".claude/skills/alpha/extra.md")).unwrap(),
        "more",
        "[{label}]"
    );

    // A dangling link is reported, pruned by sync, and removing it is safe.
    fsutil::symlink_dir_abs(
        &h.root.join("nowhere"),
        &h.root.join(".cursor/skills/ghost"),
    )
    .unwrap();
    let inv = q.scan();
    assert_eq!(
        presence(&inv, "ghost", "cursor"),
        Presence::Broken,
        "[{label}]"
    );
    assert!(
        inv.skills
            .iter()
            .find(|s| s.id == "ghost")
            .unwrap()
            .issues
            .iter()
            .any(|i| i.kind == IssueKind::BrokenLink),
        "[{label}]"
    );
    let r = q.sync_apply(true, true, true);
    assert!(r.errors.is_empty(), "[{label}] {:?}", r.errors);
    assert!(
        matches!(entry(&h.root.join(".cursor/skills/ghost")), Entry::Missing),
        "[{label}]"
    );

    // Unlinking from one agent removes only that link.
    q.set_link("alpha", "cursor", false).unwrap();
    assert!(matches!(
        entry(&h.root.join(".cursor/skills/alpha")),
        Entry::Missing
    ));
    assert!(
        h.root.join("Skills/alpha/SKILL.md").is_file(),
        "[{label}] source kept"
    );
    assert!(h.root.join(".claude/skills/alpha/SKILL.md").is_file());
    q.set_link("alpha", "cursor", true).unwrap();
    assert!(h.root.join(".cursor/skills/alpha/SKILL.md").is_file());

    // Adopting a real folder from an agent moves it into the store and leaves a link.
    write_skill(&h.root.join(".claude/skills/writer"), "writer");
    q.adopt("writer", None).unwrap();
    assert!(matches!(
        entry(&h.root.join(".agents/skills/writer")),
        Entry::Dir
    ));
    assert!(matches!(
        entry(&h.root.join(".claude/skills/writer")),
        Entry::Link { resolves: true, .. }
    ));
    assert!(matches!(
        entry(&h.root.join(".cursor/skills/writer")),
        Entry::Link { resolves: true, .. }
    ));

    // Removing deletes the links, never the My Skills content before it is trashed.
    q.remove("alpha").unwrap();
    for p in [
        ".claude/skills/alpha",
        ".cursor/skills/alpha",
        ".agents/skills/alpha",
    ] {
        assert!(
            matches!(entry(&h.root.join(p)), Entry::Missing),
            "[{label}] {p}"
        );
    }
}

/// Links disabled: agent folders get real copies; the store keeps working.
#[cfg(windows)]
fn copy_fallback() {
    let h = home();
    write_skill(&h.root.join(".agents/skills/solo"), "solo");
    let q = Quiver::with_env(Env::isolated(&h.root));
    let r = q.sync_apply(true, true, true);
    assert!(r.errors.is_empty(), "{:?}", r.errors);
    for agent in [".claude/skills/solo", ".cursor/skills/solo"] {
        let p = h.root.join(agent);
        assert!(
            matches!(entry(&p), Entry::Dir),
            "{agent} is a real copy: {:?}",
            entry(&p)
        );
        assert!(p.join("SKILL.md").is_file());
    }
    let inv = q.scan();
    assert_eq!(presence(&inv, "solo", "claude-code"), Presence::Copied);
    assert_eq!(presence(&inv, "solo", "cursor"), Presence::Copied);
    let solo = inv.skills.iter().find(|s| s.id == "solo").unwrap();
    assert!(solo.issues.is_empty(), "{:?}", solo.issues);
    // Nothing left to do: the copies count as present.
    let plan = q.sync_plan();
    assert!(plan.links.is_empty() && plan.prune.is_empty(), "{plan:?}");
    // Unlinking trashes the copy (to the backup folder) rather than leaving it.
    q.set_link("solo", "cursor", false).unwrap();
    assert!(matches!(
        entry(&h.root.join(".cursor/skills/solo")),
        Entry::Missing
    ));
    assert!(h.root.join(".agents/skills/solo/SKILL.md").is_file());
    // A store entry can't be a copy, so creating My Skills needs real links.
    assert!(q.create("mine", "needs a link").is_err());
}

#[test]
fn every_strategy_gives_the_same_answers() {
    // SAFETY: this file has one test, so nothing else reads the environment concurrently.
    unsafe { std::env::set_var("QUIVER_NO_TRASH", "1") };

    #[cfg(unix)]
    linked_lifecycle("symlink");

    #[cfg(windows)]
    {
        let set = |v: &str| unsafe { std::env::set_var("QUIVER_WINDOWS_LINKS", v) };
        set("auto");
        linked_lifecycle("auto (junction)");
        set("junction");
        linked_lifecycle("junction");

        // Real symlinks need Developer Mode or admin; skip where Windows refuses.
        let probe = tempfile::tempdir().unwrap();
        let (t, l) = (probe.path().join("t"), probe.path().join("l"));
        fs::create_dir(&t).unwrap();
        if std::os::windows::fs::symlink_dir(&t, &l).is_ok() {
            set("symlink");
            linked_lifecycle("symlink");
        } else {
            eprintln!("symlink strategy skipped: not permitted on this machine");
        }

        set("copy");
        copy_fallback();
        set("auto");
    }
}
