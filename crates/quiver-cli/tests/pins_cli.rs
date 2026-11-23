//! `quiver pin`, `unpin` and `pins` against a fake home and a fake repository.
//! Every run gets a cleared environment, so nothing of the real machine leaks in.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

struct Sandbox {
    _dir: tempfile::TempDir,
    home: PathBuf,
    repo: PathBuf,
}

impl Sandbox {
    fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let base = dir.path().to_path_buf();
        let home = base.join("home");
        let repo = base.join("repo");
        fs::create_dir_all(home.join(".claude/skills")).unwrap();
        fs::create_dir_all(home.join(".agents/skills/browser-qa/scripts")).unwrap();
        fs::write(
            home.join(".agents/skills/browser-qa/SKILL.md"),
            "---\nname: browser-qa\ndescription: Drives a browser.\n---\nbody\n",
        )
        .unwrap();
        fs::write(
            home.join(".agents/skills/browser-qa/scripts/run.sh"),
            "echo run\n",
        )
        .unwrap();
        fs::create_dir_all(repo.join(".git")).unwrap();
        Self {
            _dir: dir,
            home,
            repo,
        }
    }

    /// Runs the CLI in the repo against the sandbox home.
    fn run(&self, args: &[&str]) -> Output {
        let mut all = vec!["--home", self.home.to_str().unwrap()];
        all.extend_from_slice(args);
        run_in(&self.repo, &self.home, &all)
    }
}

fn run_in(cwd: &Path, home: &Path, args: &[&str]) -> Output {
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_quiver"));
    cmd.env_clear()
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("QUIVER_NO_TRASH", "1")
        .env("NO_COLOR", "1")
        .current_dir(cwd)
        .args(args);
    // Windows can't start much without its system folder.
    if let Some(v) = std::env::var_os("SystemRoot") {
        cmd.env("SystemRoot", v);
    }
    cmd.output().unwrap()
}

fn text(o: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&o.stdout),
        String::from_utf8_lossy(&o.stderr)
    )
}

#[test]
fn pin_verify_edit_verify_unpin() {
    let sb = Sandbox::new();
    let pin_dir = sb.repo.join(".agents/skills/browser-qa-pinned");

    let o = sb.run(&["pin", "browser-qa", "--copy"]);
    assert!(o.status.success(), "{}", text(&o));
    let out = text(&o);
    assert!(
        out.contains("pinned browser-qa as browser-qa-pinned"),
        "{out}"
    );
    assert!(
        out.contains("/browser-qa-pinned"),
        "says how to invoke it: {out}"
    );
    assert!(out.contains("quiver-pins.json"), "{out}");
    assert!(pin_dir.join("SKILL.md").is_file());
    assert!(
        sb.repo
            .join(".claude/skills/browser-qa-pinned/SKILL.md")
            .is_file()
    );
    // The CLI registered the project for the app.
    let settings = fs::read_to_string(sb.home.join(".quiver/settings.json")).unwrap();
    assert!(settings.contains("repo"), "{settings}");

    let o = sb.run(&["pins", "verify"]);
    assert!(o.status.success(), "{}", text(&o));
    assert!(text(&o).contains("intact"));
    let o = sb.run(&["pins"]);
    assert!(
        o.status.success() && text(&o).contains("browser-qa-pinned"),
        "{}",
        text(&o)
    );

    // A line-ending change alone is fine.
    let md = fs::read_to_string(pin_dir.join("SKILL.md")).unwrap();
    fs::write(pin_dir.join("SKILL.md"), md.replace('\n', "\r\n")).unwrap();
    assert!(sb.run(&["pins", "verify"]).status.success());

    // A real edit fails with the files and the fix.
    fs::write(pin_dir.join("SKILL.md"), format!("{md}edited\n")).unwrap();
    fs::write(pin_dir.join("new.md"), "x").unwrap();
    let o = sb.run(&["pins", "verify"]);
    assert_eq!(o.status.code(), Some(1), "{}", text(&o));
    let out = text(&o);
    assert!(out.contains("modified"), "{out}");
    assert!(
        out.contains("~ .agents/skills/browser-qa-pinned/SKILL.md"),
        "{out}"
    );
    assert!(
        out.contains("+ .agents/skills/browser-qa-pinned/new.md"),
        "{out}"
    );
    assert!(
        out.contains("git checkout -- .agents/skills/browser-qa-pinned"),
        "{out}"
    );
    assert!(
        out.contains("quiver pins update browser-qa-pinned"),
        "{out}"
    );

    let o = sb.run(&["pins", "verify", "--json"]);
    assert_eq!(o.status.code(), Some(1));
    let v: serde_json::Value = serde_json::from_slice(&o.stdout).unwrap();
    assert_eq!(v["ok"], false);
    assert_eq!(v["pins"][0]["state"], "modified");
    assert_eq!(
        v["pins"][0]["changedFiles"],
        serde_json::json!(["SKILL.md", "new.md"])
    );

    // Accept the edit, then it passes.
    let o = sb.run(&["pins", "update", "browser-qa-pinned", "--accept"]);
    assert!(o.status.success(), "{}", text(&o));
    assert!(sb.run(&["pins", "verify"]).status.success());

    // Re-pin from the shared copy discards the edit.
    let o = sb.run(&["pins", "update", "browser-qa-pinned"]);
    assert!(o.status.success(), "{}", text(&o));
    assert!(!pin_dir.join("new.md").exists());
    assert!(sb.run(&["pins", "verify"]).status.success());

    // A removed copy is a links problem and `pins sync` repairs it.
    fs::remove_dir_all(sb.repo.join(".claude/skills/browser-qa-pinned")).unwrap();
    let o = sb.run(&["pins", "verify"]);
    assert_eq!(o.status.code(), Some(1));
    assert!(text(&o).contains("quiver pins sync"), "{}", text(&o));
    assert!(sb.run(&["pins", "sync"]).status.success());
    assert!(sb.run(&["pins", "verify"]).status.success());

    let o = sb.run(&["unpin", "browser-qa-pinned"]);
    assert!(o.status.success(), "{}", text(&o));
    assert!(!pin_dir.exists());
    assert!(!sb.repo.join("quiver-pins.json").exists());
    assert!(!sb.repo.join(".claude/skills/browser-qa-pinned").exists());
    assert!(sb.home.join(".agents/skills/browser-qa/SKILL.md").is_file());
}

#[test]
fn verify_needs_nothing_but_the_checkout() {
    let sb = Sandbox::new();
    assert!(
        sb.run(&["pin", "browser-qa", "--as", "qa-release", "--copy"])
            .status
            .success()
    );

    // A bare CI machine: a home that doesn't exist, no ~/.agents, no --home flag.
    let bare = sb.repo.parent().unwrap().join("no-such-home");
    let sub = sb.repo.join(".agents/skills");
    for cwd in [&sb.repo, &sub] {
        let o = run_in(cwd, &bare, &["pins", "verify"]);
        assert!(o.status.success(), "{}", text(&o));
        assert!(text(&o).contains("qa-release"));
    }
    assert!(!bare.exists(), "verify created nothing outside the project");
    // -C works from anywhere.
    let elsewhere = sb.repo.parent().unwrap();
    let o = run_in(
        elsewhere,
        &bare,
        &["pins", "verify", "-C", sb.repo.to_str().unwrap()],
    );
    assert!(o.status.success(), "{}", text(&o));

    // Edits are caught there too.
    fs::write(sb.repo.join(".agents/skills/qa-release/extra.txt"), "x").unwrap();
    let o = run_in(&sb.repo, &bare, &["pins", "verify"]);
    assert_eq!(o.status.code(), Some(1));
    assert!(!bare.exists());
}

#[test]
fn verify_without_a_lock_passes_and_a_broken_lock_fails() {
    let sb = Sandbox::new();
    let o = sb.run(&["pins", "verify"]);
    assert!(o.status.success());
    assert!(text(&o).contains("nothing to verify"), "{}", text(&o));
    fs::write(sb.repo.join("quiver-pins.json"), "{ nope").unwrap();
    let o = sb.run(&["pins", "verify"]);
    assert_eq!(o.status.code(), Some(1));
    assert!(text(&o).contains("quiver-pins.json"), "{}", text(&o));
}

#[test]
fn a_pin_named_like_a_global_skill_is_refused_with_the_reason() {
    let sb = Sandbox::new();
    let o = sb.run(&["pin", "browser-qa", "--as", "browser-qa", "--copy"]);
    assert_eq!(o.status.code(), Some(1));
    let out = text(&o);
    assert!(
        out.contains("Claude Code ranks personal skills above project ones"),
        "{out}"
    );
    assert!(!sb.repo.join(".agents").exists());
    let o = sb.run(&["pin", "browser-qa", "--as", "Bad_Name", "--copy"]);
    assert_eq!(o.status.code(), Some(1));
    // The default name is `<skill>-pinned`.
    assert!(
        sb.run(&["pin", "browser-qa", "--copy", "--agents", "claude-code"])
            .status
            .success()
    );
    assert!(sb.repo.join(".agents/skills/browser-qa-pinned").is_dir());
}
