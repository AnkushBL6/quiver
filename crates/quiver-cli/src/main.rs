//! `quiver`: the universal skill manager for AI coding agents, from the terminal.

use anyhow::Result;
use clap::{Parser, Subcommand};
use quiver_core::*;
use std::io::IsTerminal;

#[derive(Parser)]
#[command(name = "quiver", version, about = "One skill library for every AI coding agent", long_about = None)]
struct Cli {
    /// Output JSON instead of text.
    #[arg(long, global = true)]
    json: bool,
    /// Operate on an isolated home directory (ignores env overrides such as
    /// CLAUDE_CONFIG_DIR). Useful for testing and demos.
    #[arg(long, global = true, value_name = "DIR")]
    home: Option<std::path::PathBuf>,
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// List every skill and which agents can see it.
    List {
        /// Only skills visible to this agent id.
        #[arg(long)]
        agent: Option<String>,
        /// Only your own skills (from the My Skills folder).
        #[arg(long)]
        mine: bool,
    },
    /// List known agents and whether they're installed.
    Agents {
        /// Include agents that aren't installed.
        #[arg(long)]
        all: bool,
    },
    /// Show one skill in detail.
    Show { id: String },
    /// Install skills from owner/repo, a URL, a git URL, a folder or a zip.
    Install {
        source: String,
        /// Only install these skills (by name). Default: all found.
        #[arg(short, long)]
        skill: Vec<String>,
        /// Link only to these agents. Default: settings / all detected.
        #[arg(short, long)]
        agent: Vec<String>,
        /// Replace already-installed skills.
        #[arg(long)]
        overwrite: bool,
    },
    /// Make a skill visible to an agent.
    Link { id: String, agent: String },
    /// Hide a skill from an agent.
    Unlink { id: String, agent: String },
    /// Move a skill into the shared store and link it to every agent.
    Adopt {
        id: String,
        /// On conflict, keep the copy at this path.
        #[arg(long)]
        from: Option<std::path::PathBuf>,
    },
    /// Remove a skill everywhere (folders go to the Trash / Recycle Bin).
    Remove { id: String },
    /// Your own skills (~/Skills): status, commit, push, pull, or adopt one.
    Mine {
        #[command(subcommand)]
        action: Option<MineCmd>,
    },
    /// Open a skill in your editor.
    Edit { id: String },
    /// Create a new skill of your own in the My Skills folder.
    New {
        id: String,
        #[arg(short, long, default_value = "")]
        description: String,
    },
    /// Check for updates.
    Outdated,
    /// Update skills (all with available updates if none given).
    Update {
        ids: Vec<String>,
        /// Overwrite local edits.
        #[arg(long)]
        force: bool,
    },
    /// Show what is out of sync, or fix it with --apply.
    Doctor {
        #[arg(long)]
        apply: bool,
    },
    /// Compare conflicting copies of a skill: which one has the fix?
    /// Prints the versions found and a coloured unified diff between two of them.
    Diff {
        id: String,
        /// Version to compare from, e.g. `v1` (default: the shared copy).
        #[arg(long)]
        from: Option<String>,
        /// Version to compare to (default: the newest other version).
        #[arg(long)]
        to: Option<String>,
        /// Only this file (path inside the skill).
        #[arg(short, long)]
        file: Option<String>,
        /// Don't ask GitHub whether a version matches the latest upstream.
        #[arg(long)]
        offline: bool,
    },
    /// Show or set universal mode (every skill in every agent, automatically).
    Universal {
        /// "on" or "off". Omit to show the current state.
        state: Option<String>,
    },
    /// Find where skills without a source came from (verified against GitHub),
    /// and with --apply start tracking them for updates.
    Sources {
        ids: Vec<String>,
        /// Track verified matches (identical folder or SKILL.md).
        #[arg(long)]
        apply: bool,
    },
    /// Search the skills.sh directory.
    Search { query: Vec<String> },
    /// Pin a skill for one project: a fixed copy committed in the repo, under its
    /// own name, while every other project keeps using the shared one.
    Pin {
        /// The skill to pin (a skill in your shared library).
        skill: String,
        /// Name of the pinned copy (default: `<skill>-pinned`). It must differ from
        /// every globally installed skill: Claude Code ranks personal skills above
        /// project ones, so a project skill with the same name would be ignored.
        #[arg(long = "as", value_name = "NAME")]
        name: Option<String>,
        /// Pin a version from the skill's GitHub source instead: a tag, branch or
        /// commit. Recorded as the full commit SHA.
        #[arg(long = "ref", value_name = "REF")]
        git_ref: Option<String>,
        /// Any folder in the project (default: the current one). The git root is used.
        #[arg(short = 'C', long = "dir", value_name = "DIR")]
        dir: Option<std::path::PathBuf>,
        /// Agents that get the pin, e.g. `claude-code,cursor` (default: every detected agent).
        #[arg(long, value_delimiter = ',', value_name = "IDS")]
        agents: Vec<String>,
        /// Real copies instead of symlinks (for repos used on Windows).
        #[arg(long)]
        copy: bool,
    },
    /// Remove a pin: its folders go to the Trash, its links are deleted.
    Unpin {
        name: String,
        #[arg(short = 'C', long = "dir", value_name = "DIR")]
        dir: Option<std::path::PathBuf>,
    },
    /// List the pinned skills of this project and their state; `verify` checks them in CI.
    Pins {
        /// Any folder in the project (default: the current one). The git root is used.
        #[arg(short = 'C', long = "dir", value_name = "DIR", global = true)]
        dir: Option<std::path::PathBuf>,
        #[command(subcommand)]
        action: Option<PinsCmd>,
    },
}

#[derive(clap::Subcommand)]
enum PinsCmd {
    /// For CI: offline, needs no ~/.agents. Exit 0 when every pin is intact, 1 otherwise.
    Verify,
    /// Re-pin from your current shared copy, or from the skill's GitHub source at --ref.
    Update {
        name: String,
        /// Tag, branch or commit on the skill's GitHub source.
        #[arg(long = "ref", value_name = "REF", conflicts_with = "accept")]
        git_ref: Option<String>,
        /// Keep the pin's files as they are now (after a deliberate edit) instead of re-pinning.
        #[arg(long)]
        accept: bool,
    },
    /// Recreate missing or wrong links and copies. Never changes pinned content.
    Sync,
}

struct Style {
    on: bool,
}
impl Style {
    fn paint(&self, code: &str, s: &str) -> String {
        if self.on {
            format!("\x1b[{code}m{s}\x1b[0m")
        } else {
            s.to_string()
        }
    }
    fn dim(&self, s: &str) -> String {
        self.paint("2", s)
    }
    fn bold(&self, s: &str) -> String {
        self.paint("1", s)
    }
    fn green(&self, s: &str) -> String {
        self.paint("32", s)
    }
    fn yellow(&self, s: &str) -> String {
        self.paint("33", s)
    }
    fn red(&self, s: &str) -> String {
        self.paint("31", s)
    }
    fn accent(&self, s: &str) -> String {
        self.paint("35", s)
    }
    fn cyan(&self, s: &str) -> String {
        self.paint("36", s)
    }
}

/// "3 days ago" for a Unix-millis timestamp.
fn ago(ms: Option<i64>) -> String {
    let Some(ms) = ms else {
        return "unknown".into();
    };
    let s = ((store::now_ms() - ms) / 1000).max(0);
    let n = |n: i64, unit: &str| format!("{n} {unit}{} ago", if n == 1 { "" } else { "s" });
    match s {
        0..45 => "just now".into(),
        45..3600 => n((s + 30) / 60, "minute"),
        3600..86_400 => n((s + 1800) / 3600, "hour"),
        86_400..5_184_000 => n((s + 43_200) / 86_400, "day"),
        _ => n(s / 2_592_000, "month"),
    }
}

/// Where a version lives, in words: the shared store and/or the agents that see it.
fn version_where(q: &Quiver, agents: &[agents::Agent], v: &SkillVersion) -> String {
    let names: Vec<&str> = v
        .agent_ids
        .iter()
        .filter_map(|id| agents.iter().find(|a| &a.id == id))
        .map(|a| a.name.as_str())
        .collect();
    let shown = names.iter().take(4).copied().collect::<Vec<_>>().join(", ");
    let more = names.len().saturating_sub(4);
    let agents = match (names.is_empty(), more) {
        (true, _) => String::new(),
        (false, 0) => shown,
        (false, n) => format!("{shown} and {n} more"),
    };
    match (v.shared, agents.is_empty()) {
        (true, true) => "Shared store".into(),
        (true, false) => format!("Shared store · {agents}"),
        (false, false) => agents,
        (false, true) => v
            .locations
            .first()
            .map(|l| q.env.display(std::path::Path::new(&l.path)))
            .unwrap_or_default(),
    }
}

/// One diff line: `+`/`-` and the text, with the changed spans in reverse video.
fn diff_line(st: &Style, colour: &str, sign: char, text: &str, marks: &[(usize, usize)]) -> String {
    if !st.on || marks.is_empty() {
        return st.paint(colour, &format!("{sign}{text}"));
    }
    let mut out = st.paint(colour, &sign.to_string());
    for (piece, changed) in compare::split_marked(text, marks) {
        out.push_str(&st.paint(
            &if changed {
                format!("{colour};7")
            } else {
                colour.into()
            },
            &piece,
        ));
    }
    out
}

/// A unified diff of one file, hunk by hunk. `a` and `b` label the two sides.
fn print_unified(st: &Style, d: &FileDiff, a: &str, b: &str) {
    let name = |side: &str, exists: bool| {
        if exists {
            format!("{side}/{}", d.path)
        } else {
            "/dev/null".into()
        }
    };
    println!(
        "{}",
        st.bold(&format!("--- {}", name(a, d.left_size.is_some())))
    );
    println!(
        "{}",
        st.bold(&format!("+++ {}", name(b, d.right_size.is_some())))
    );
    for block in d.blocks.iter().filter(|b| !b.collapsed) {
        let left = block.rows.iter().filter(|r| r.left_no.is_some());
        let right = block.rows.iter().filter(|r| r.right_no.is_some());
        println!(
            "{}",
            st.cyan(&format!(
                "@@ -{},{} +{},{} @@",
                left.clone().next().and_then(|r| r.left_no).unwrap_or(0),
                left.count(),
                right.clone().next().and_then(|r| r.right_no).unwrap_or(0),
                right.count()
            ))
        );
        // Unified diffs list a change's removals before its additions.
        let (mut removed, mut added): (Vec<String>, Vec<String>) = (vec![], vec![]);
        let flush = |removed: &mut Vec<String>, added: &mut Vec<String>| {
            for line in removed.drain(..).chain(added.drain(..)) {
                println!("{line}");
            }
        };
        for r in &block.rows {
            if let Some(l) = r.left.as_deref().filter(|_| r.kind != RowKind::Equal) {
                removed.push(diff_line(st, "31", '-', l, &r.left_marks));
            }
            if let Some(t) = r.right.as_deref().filter(|_| r.kind != RowKind::Equal) {
                added.push(diff_line(st, "32", '+', t, &r.right_marks));
            }
            if r.kind == RowKind::Equal {
                flush(&mut removed, &mut added);
                println!(" {}", r.left.as_deref().unwrap_or_default());
            }
        }
        flush(&mut removed, &mut added);
    }
}

#[derive(clap::Subcommand)]
enum MineCmd {
    /// Create the folder and make it a git repo.
    Init,
    /// Make a skill yours: move it into My Skills and stop upstream updates.
    Add {
        ids: Vec<String>,
    },
    /// Commit changes (all, or only the given skills).
    Commit {
        #[arg(short, long)]
        message: String,
        ids: Vec<String>,
    },
    Push,
    Pull,
}

/// Older Windows consoles print ANSI escapes literally unless asked to interpret them.
#[cfg(windows)]
fn enable_ansi() {
    use windows_sys::Win32::System::Console::{
        ENABLE_VIRTUAL_TERMINAL_PROCESSING, GetConsoleMode, GetStdHandle, STD_ERROR_HANDLE,
        STD_OUTPUT_HANDLE, SetConsoleMode,
    };
    for which in [STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        // SAFETY: plain Win32 calls on the process's own std handles; failures (no console,
        // redirected output) are ignored because colour is only used on a terminal.
        unsafe {
            let handle = GetStdHandle(which);
            let mut mode = 0;
            if GetConsoleMode(handle, &mut mode) != 0 {
                SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
            }
        }
    }
}

fn main() {
    #[cfg(windows)]
    enable_ansi();
    if let Err(e) = run() {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

fn print_json<T: serde::Serialize>(v: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(v)?);
    Ok(())
}

// ---------- Pinned skills ----------

/// The folder a pin command works on: `-C DIR`, else the current folder.
fn project_dir(dir: Option<std::path::PathBuf>) -> Result<std::path::PathBuf> {
    let d = match dir {
        Some(d) => d,
        None => std::env::current_dir()?,
    };
    anyhow::ensure!(d.is_dir(), "{} isn't a folder", d.display());
    Ok(d)
}

fn pin_state_label(st: &Style, s: PinState) -> String {
    match s {
        PinState::Ok => st.green("ok"),
        PinState::Modified => st.red("modified"),
        PinState::Missing => st.red("missing"),
        PinState::Links => st.yellow("links"),
    }
}

fn agent_name(id: &str) -> String {
    agents::builtin()
        .iter()
        .find(|d| d.id == id)
        .map(|d| d.name.clone())
        .unwrap_or_else(|| id.to_string())
}

fn pin_origin(p: &Pin) -> String {
    match (&p.pinned_from, &p.git_ref, &p.source) {
        (PinnedFrom::Github, Some(sha), Some(src)) => {
            format!("{} at {}", src.source, &sha[..sha.len().min(10)])
        }
        (PinnedFrom::Github, Some(sha), None) => format!("GitHub at {}", &sha[..sha.len().min(10)]),
        _ => "your shared copy".to_string(),
    }
}

/// `quiver pins verify`: needs only the project folder, no home directory, no network.
/// Returns whether every pin is intact.
fn pins_verify(st: &Style, json: bool, dir: Option<std::path::PathBuf>) -> Result<bool> {
    let dir = project_dir(dir)?;
    let root = pins::find_root(&dir);
    let checks = pins::verify_project(&root)?;
    let bad = checks
        .iter()
        .filter(|c| c.pin.state != PinState::Ok)
        .count();
    if json {
        print_json(&serde_json::json!({
            "ok": bad == 0,
            "pins": checks.iter().map(|c| &c.pin).collect::<Vec<_>>(),
        }))?;
        return Ok(bad == 0);
    }
    if checks.is_empty() {
        println!(
            "No pinned skills in {} ({} not found or empty); nothing to verify.",
            root.display(),
            pins::LOCK_FILE
        );
        return Ok(true);
    }
    for c in &checks {
        let p = &c.pin;
        let name = &p.name;
        let folder = format!(".agents/skills/{name}");
        if p.state == PinState::Ok {
            println!("{} {:<36} {}", st.green("✓"), st.bold(name), st.dim("ok"));
            continue;
        }
        println!(
            "{} {:<36} {}",
            st.red("✗"),
            st.bold(name),
            pin_state_label(st, p.state)
        );
        for (mark, files) in [("~", &c.changed), ("+", &c.added), ("-", &c.removed)] {
            for f in files {
                println!("    {mark} {folder}/{f}");
            }
        }
        for problem in p
            .problems
            .iter()
            .filter(|m| !m.contains("changed since the pin was made"))
        {
            println!("    {problem}");
        }
        match p.state {
            PinState::Modified => {
                println!("  {}", st.dim("To undo the edits:"));
                println!("    git checkout -- {folder}");
                println!(
                    "  {}",
                    st.dim("To accept them, or to re-pin from your shared copy:")
                );
                println!("    quiver pins update {name} --accept");
                println!("    quiver pins update {name}");
            }
            PinState::Missing => {
                println!("  {}", st.dim("To restore it:"));
                println!("    git checkout -- {folder}");
                println!("    quiver pins update {name}");
            }
            _ => {
                println!("  {}", st.dim("To repair the links and copies:"));
                println!("    quiver pins sync");
            }
        }
    }
    let total = checks.len();
    if bad == 0 {
        println!(
            "\nAll {total} pinned skill{} intact.",
            if total == 1 { " is" } else { "s are" }
        );
    } else {
        println!(
            "\n{bad} of {total} pinned skill{} need{} attention.",
            if total == 1 { "" } else { "s" },
            if bad == 1 { "s" } else { "" }
        );
    }
    Ok(bad == 0)
}

/// The pins of a project with their state (what `quiver pins` shows).
fn print_pins(st: &Style, d: &ProjectDetail) {
    let s = &d.summary;
    let branch = s
        .branch
        .as_ref()
        .map(|b| format!("  branch {b}"))
        .unwrap_or_default();
    println!(
        "{} {}{}",
        st.bold(&s.name),
        st.dim(&s.display_path),
        st.dim(&branch)
    );
    if d.pins.is_empty() {
        println!("No pinned skills. Pin one with `quiver pin <skill>`.");
    }
    for p in &d.pins {
        let mark = if p.state == PinState::Ok {
            st.green("✓")
        } else {
            st.red("✗")
        };
        println!(
            "{mark} {:<36} {}  {}",
            st.bold(&p.name),
            pin_state_label(st, p.state),
            st.dim(&format!("{} from {}", p.skill, pin_origin(p)))
        );
        for problem in &p.problems {
            println!("    {problem}");
        }
        if p.shared_changed == Some(true) {
            println!(
                "    {}",
                st.dim(&format!(
                    "Your shared copy of {} has changed since. `quiver pins update {}` re-pins it.",
                    p.skill, p.name
                ))
            );
        }
        if !p.name_clash.is_empty() {
            println!(
                "    {} a global skill named {} exists for {}; Claude Code ranks personal skills above project ones, so rename the pin.",
                st.yellow("!"),
                p.name,
                p.name_clash
                    .iter()
                    .map(|a| agent_name(a))
                    .collect::<Vec<_>>()
                    .join(", ")
            );
        }
    }
    if !d.other_skills.is_empty() {
        println!(
            "{}",
            st.dim(&format!(
                "{} other skill{} in this project (not pins).",
                d.other_skills.len(),
                if d.other_skills.len() == 1 { "" } else { "s" }
            ))
        );
    }
}

/// What `quiver pin` wrote, and how to use it.
fn print_pinned(st: &Style, q: &Quiver, d: &ProjectDetail, p: &Pin) {
    println!(
        "{} pinned {} as {} in {}",
        st.green("✓"),
        st.bold(&p.skill),
        st.bold(&p.name),
        q.env.display(std::path::Path::new(&d.summary.path))
    );
    println!("  {}", st.dim(&format!("from {}", pin_origin(p))));
    let native: Vec<String> = p
        .agents
        .iter()
        .filter(|a| a.kind == PinLinkKind::Native)
        .map(|a| agent_name(&a.agent_id))
        .collect();
    println!(
        "  {:<44} {}",
        format!(".agents/skills/{}", p.name),
        st.dim(&if native.is_empty() {
            "the pinned copy (real files)".to_string()
        } else {
            format!(
                "the pinned copy; {} read{} it directly",
                native.join(", "),
                if native.len() == 1 { "s" } else { "" }
            )
        })
    );
    let mut shown: Vec<&str> = Vec::new();
    for a in p.agents.iter().filter(|a| a.kind != PinLinkKind::Native) {
        if shown.contains(&a.dir.as_str()) {
            continue;
        }
        shown.push(&a.dir);
        let who: Vec<String> = p
            .agents
            .iter()
            .filter(|b| b.dir == a.dir)
            .map(|b| agent_name(&b.agent_id))
            .collect();
        let up = "../".repeat(a.dir.split('/').count().saturating_sub(1));
        let how = match a.kind {
            PinLinkKind::Symlink => format!("-> {up}.agents/skills/{}", p.name),
            _ => "(copy)".to_string(),
        };
        println!(
            "  {:<44} {}",
            format!("{} {how}", a.dir),
            st.dim(&who.join(", "))
        );
    }
    println!(
        "  {:<44} {}",
        pins::LOCK_FILE,
        st.dim("the lock; commit it with the folders above")
    );
    println!(
        "\nUse it as {} in Claude Code; other agents load it by the name {}.",
        st.bold(&format!("/{}", p.name)),
        p.name
    );
    let mut add: Vec<&str> = vec![".agents"];
    for a in p.agents.iter().filter(|a| a.kind != PinLinkKind::Native) {
        let top = a.dir.split('/').next().unwrap_or("");
        if !top.is_empty() && !add.contains(&top) {
            add.push(top);
        }
    }
    println!(
        "{}",
        st.dim(&format!(
            "Commit it: git add {} {}. Check it in CI with `quiver pins verify`.",
            add.join(" "),
            pins::LOCK_FILE
        ))
    );
    if p.mode == PinMode::Symlink {
        println!(
            "{}",
            st.dim("Repos used on Windows should pin with --copy: git checks symlinks out as text files there.")
        );
    }
}

fn report(st: &Style, r: &OpReport) {
    for id in &r.ok {
        println!("{} {id}", st.green("✓"));
    }
    for m in &r.skipped {
        println!("{} {}: {}", st.yellow("–"), m.id, st.dim(&m.message));
    }
    for m in &r.errors {
        println!("{} {}: {}", st.red("✗"), m.id, m.message);
    }
}

fn run() -> Result<()> {
    let cli = Cli::parse();
    let st = Style {
        on: std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none() && !cli.json,
    };
    // `pins verify` is for CI: it must work in a bare checkout, so it never builds a
    // Quiver (no home directory, no settings, no ~/.agents).
    if let Cmd::Pins {
        dir,
        action: Some(PinsCmd::Verify),
    } = &cli.cmd
    {
        let intact = pins_verify(&st, cli.json, dir.clone())?;
        std::process::exit(if intact { 0 } else { 1 });
    }
    let q = match &cli.home {
        Some(h) => {
            std::fs::create_dir_all(h)?;
            let mut env = Env::isolated(fsutil::canonicalize(h)?);
            env.probe_system = false;
            Quiver::with_env(env)
        }
        None => Quiver::system(),
    };

    match cli.cmd {
        Cmd::List { agent, mine } => {
            let inv = q.scan();
            let skills: Vec<&Skill> = inv
                .skills
                .iter()
                .filter(|s| !mine || s.origin == Origin::Mine)
                .filter(|s| {
                    agent.as_ref().is_none_or(|a| {
                        s.presence.iter().any(|p| {
                            &p.agent_id == a
                                && !matches!(p.presence, Presence::Absent | Presence::Broken)
                        })
                    })
                })
                .collect();
            if cli.json {
                return print_json(&skills);
            }
            let active: Vec<&AgentInfo> = inv
                .agents
                .iter()
                .filter(|a| a.detected && a.enabled)
                .collect();
            for s in &skills {
                let visible = s
                    .presence
                    .iter()
                    .filter(|p| {
                        active.iter().any(|a| a.id == p.agent_id)
                            && !matches!(p.presence, Presence::Absent | Presence::Broken)
                    })
                    .count();
                let mark = if s.read_only {
                    st.dim("plugin")
                } else if s.origin == Origin::Mine {
                    st.accent("★")
                } else if s.managed {
                    st.green("●")
                } else {
                    st.yellow("○")
                };
                let mut warn = if s.issues.iter().any(|i| i.severity != "info") {
                    st.red(" !")
                } else {
                    String::new()
                };
                if let Some(n) = s.git_changes.filter(|n| *n > 0) {
                    warn.push_str(&st.yellow(&format!(" {n} uncommitted")));
                }
                println!(
                    "{mark} {:<40} {}{warn}",
                    st.bold(&s.id),
                    st.dim(&format!("{visible}/{} agents", active.len()))
                );
            }
            println!(
                "\n{} skills · {} managed · {} only in one agent's folder · {} with issues · {} agents",
                inv.stats.total,
                inv.stats.managed,
                inv.stats.unmanaged,
                inv.stats.with_issues,
                inv.stats.agents_detected
            );
        }
        Cmd::Agents { all } => {
            let inv = q.scan();
            let agents: Vec<&AgentInfo> = inv.agents.iter().filter(|a| all || a.detected).collect();
            if cli.json {
                return print_json(&agents);
            }
            for a in agents {
                let status = if !a.detected {
                    st.dim("not installed")
                } else if !a.enabled {
                    st.dim("hidden")
                } else {
                    st.green("detected")
                };
                let native = if a.reads_canonical {
                    st.accent(" (reads store natively)")
                } else {
                    String::new()
                };
                println!(
                    "{:<26} {:<14} {:>4} skills  {}{native}",
                    st.bold(&a.name),
                    status,
                    a.skill_count,
                    st.dim(&a.skills_dir)
                );
            }
        }
        Cmd::Show { id } => {
            let d = q.detail(&id)?;
            if cli.json {
                return print_json(&d);
            }
            let s = &d.skill;
            println!(
                "{}  {}",
                st.bold(&s.name),
                st.dim(s.version.as_deref().unwrap_or(""))
            );
            println!("{}\n", s.description);
            if let Some(src) = &s.source {
                println!("source   {} ({})", src.source, src.kind);
            }
            println!("files    {} ({} KB)", s.file_count, s.size_bytes / 1024);
            println!("\nlocations:");
            for l in &s.locations {
                println!(
                    "  {:<12} {}",
                    format!("{:?}", l.kind).to_lowercase(),
                    l.path
                );
            }
            println!("\nagents:");
            let inv = q.scan();
            for p in s.presence.iter().filter(|p| p.presence != Presence::Absent) {
                let name = inv
                    .agents
                    .iter()
                    .find(|a| a.id == p.agent_id)
                    .map(|a| a.name.as_str())
                    .unwrap_or(&p.agent_id);
                println!("  {:<26} {:?}", name, p.presence);
            }
            for i in &s.issues {
                println!(
                    "{} {}",
                    if i.severity == "info" {
                        st.dim("i")
                    } else {
                        st.yellow("!")
                    },
                    i.message
                );
            }
        }
        Cmd::Install {
            source,
            skill,
            agent,
            overwrite,
        } => {
            let session = q.resolve(&source)?;
            let picked: Vec<String> = session
                .resolved
                .candidates
                .iter()
                .filter(|c| skill.is_empty() || skill.iter().any(|s| s == &c.id || s == &c.name))
                .map(|c| c.path.clone())
                .collect();
            anyhow::ensure!(
                !picked.is_empty(),
                "none of {:?} found in {}",
                skill,
                session.resolved.display
            );
            if !cli.json {
                println!(
                    "Installing {} skill(s) from {}",
                    picked.len(),
                    session.resolved.display
                );
            }
            let r = q.install(&session, &picked, &agent, overwrite);
            if cli.json {
                print_json(&r)?;
            } else {
                report(&st, &r);
            }
        }
        Cmd::Link { id, agent } => {
            q.set_link(&id, &agent, true)?;
            println!("{} {id} → {agent}", st.green("✓"));
        }
        Cmd::Unlink { id, agent } => {
            q.set_link(&id, &agent, false)?;
            println!("{} {id} hidden from {agent}", st.green("✓"));
        }
        Cmd::Adopt { id, from } => {
            q.adopt(&id, from.as_deref())?;
            println!("{} {id} is now universal", st.green("✓"));
        }
        Cmd::Remove { id } => {
            q.remove(&id)?;
            println!(
                "{} removed {id} (folders moved to the {})",
                st.green("✓"),
                fsutil::TRASH_NAME
            );
        }
        Cmd::New { id, description } => {
            q.create(&id, &description)?;
            println!(
                "{} created {}",
                st.green("✓"),
                q.my_dir().join(&id).join("SKILL.md").display()
            );
        }
        Cmd::Edit { id } => q.open_in_editor(&id)?,
        Cmd::Mine { action } => match action {
            None => {
                let s = q.my_skills_status();
                if cli.json {
                    return print_json(&s);
                }
                println!("{} {}", st.bold("My Skills"), st.dim(&s.display_dir));
                if let Some(p) = &s.problem {
                    println!("{} {p}", st.red("✗"));
                    return Ok(());
                }
                if !s.exists {
                    println!("Not created yet. Run `quiver new <name>` or `quiver mine init`.");
                    return Ok(());
                }
                println!("{} skill(s)", s.count);
                if s.is_repo {
                    let mut line = format!("branch {}", s.branch.as_deref().unwrap_or("(none)"));
                    if let Some(r) = s.github_repo.as_ref().or(s.remote.as_ref()) {
                        line.push_str(&format!(" · {r}"));
                    }
                    if s.ahead + s.behind > 0 {
                        line.push_str(&format!(" · ↑{} ↓{}", s.ahead, s.behind));
                    }
                    println!("{}", st.dim(&line));
                    if let Some(c) = &s.last_commit {
                        println!(
                            "{}",
                            st.dim(&format!("last commit {} {}", c.hash, c.subject))
                        );
                    }
                    for c in &s.changes {
                        println!("  {} {}", st.yellow(&format!("{:>2}", c.status)), c.path);
                    }
                    if s.changes.is_empty() {
                        println!("{} nothing to commit", st.green("✓"));
                    }
                } else if s.git_available {
                    println!("Not a git repo. Run `quiver mine init` to track changes.");
                }
            }
            Some(MineCmd::Init) => {
                let s = q.my_skills_init()?;
                println!("{} {} is ready", st.green("✓"), s.display_dir);
            }
            Some(MineCmd::Add { ids }) => {
                for id in ids {
                    q.make_mine(&id)?;
                    println!(
                        "{} {id} is yours: {}",
                        st.green("✓"),
                        q.env.display(&q.my_dir().join(&id))
                    );
                }
            }
            Some(MineCmd::Commit { message, ids }) => {
                let h = q.my_skills_commit(&message, &ids)?;
                println!("{} committed {h}", st.green("✓"));
            }
            Some(MineCmd::Push) => println!("{}", q.my_skills_push()?),
            Some(MineCmd::Pull) => println!("{}", q.my_skills_pull()?),
        },
        Cmd::Outdated => {
            let infos = q.check_updates(true);
            if cli.json {
                return print_json(&infos);
            }
            let mut any = false;
            for u in &infos {
                match u.status {
                    UpdateStatus::Available => {
                        any = true;
                        let m = if u.locally_modified {
                            st.yellow(" (local edits)")
                        } else {
                            String::new()
                        };
                        println!(
                            "{} {:<40} {}{m}",
                            st.accent("↑"),
                            u.id,
                            st.dim(u.source.as_deref().unwrap_or(""))
                        );
                    }
                    UpdateStatus::Error => println!(
                        "{} {:<40} {}",
                        st.red("✗"),
                        u.id,
                        st.dim(u.message.as_deref().unwrap_or(""))
                    ),
                    _ => {}
                }
            }
            let n = |s: UpdateStatus| infos.iter().filter(|u| u.status == s).count();
            println!(
                "{}{} up to date · {} available · {} untracked · {} errors",
                if any { "\n" } else { "" },
                n(UpdateStatus::UpToDate),
                n(UpdateStatus::Available),
                n(UpdateStatus::Untracked),
                n(UpdateStatus::Error)
            );
        }
        Cmd::Update { ids, force } => {
            let ids = if ids.is_empty() {
                q.check_updates(true)
                    .into_iter()
                    .filter(|u| u.status == UpdateStatus::Available)
                    .map(|u| u.id)
                    .collect()
            } else {
                ids
            };
            if ids.is_empty() {
                println!("Everything is up to date.");
                return Ok(());
            }
            let r = q.update(&ids, force);
            if cli.json {
                print_json(&r)?;
            } else {
                report(&st, &r);
            }
        }
        Cmd::Doctor { apply } => {
            let plan = q.sync_plan();
            if cli.json && !apply {
                return print_json(&plan);
            }
            if !plan.register.is_empty() {
                println!(
                    "{} new skill(s) of yours to register: {}",
                    plan.register.len(),
                    plan.register.join(", ")
                );
            }
            println!(
                "{} skill(s) to make universal, {} missing link(s), {} broken link(s), {} conflict(s)",
                plan.adopt.len(),
                plan.links.len(),
                plan.prune.len(),
                plan.conflicts.len()
            );
            for c in &plan.conflicts {
                println!(
                    "  {} {c}: different copies exist; run `quiver diff {c}` to see what differs, then `quiver adopt {c} --from <path>`",
                    st.yellow("!")
                );
            }
            if apply {
                let r = q.sync_apply(true, true, true);
                if cli.json {
                    print_json(&r)?;
                } else {
                    println!("{} done, {} error(s)", r.ok.len(), r.errors.len());
                    for m in &r.errors {
                        println!("{} {}: {}", st.red("✗"), m.id, m.message);
                    }
                }
            } else if !(plan.adopt.is_empty()
                && plan.links.is_empty()
                && plan.prune.is_empty()
                && plan.register.is_empty())
            {
                println!("Run `quiver doctor --apply` to fix.");
            }
        }
        Cmd::Diff {
            id,
            from,
            to,
            file,
            offline,
        } => {
            let c = q.compare_copies(&id)?;
            let upstream = (!offline && c.upstream_source.is_some())
                .then(|| q.compare_upstream(&id))
                .transpose()?;
            let find = |spec: &str| -> Result<&SkillVersion> {
                let want = format!("v{}", spec.trim_start_matches('v'));
                c.versions.iter().find(|v| v.id == want).ok_or_else(|| {
                    anyhow::anyhow!(
                        "no version `{spec}`; this skill has {}",
                        c.versions
                            .iter()
                            .map(|v| v.id.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                })
            };
            let pair = match (&from, &to, &c.suggested) {
                (Some(f), Some(t), _) => Some((find(f)?, find(t)?)),
                (Some(f), None, Some((_, r))) => Some((find(f)?, find(r)?)),
                (None, Some(t), Some((l, _))) => Some((find(l)?, find(t)?)),
                (None, None, Some((l, r))) => Some((find(l)?, find(r)?)),
                _ => None,
            };
            let differs = |f: &FileCompare, l: &SkillVersion, r: &SkillVersion| {
                let at = |v: &SkillVersion| {
                    c.versions
                        .iter()
                        .position(|x| x.id == v.id)
                        .and_then(|i| f.variants[i].as_ref())
                };
                at(l).map(|x| &x.digest) != at(r).map(|x| &x.digest)
            };
            let diffs: Vec<FileDiff> = match pair {
                Some((l, r)) => c
                    .files
                    .iter()
                    .filter(|f| file.as_ref().is_none_or(|p| p == &f.path))
                    .filter(|f| differs(f, l, r))
                    .map(|f| q.compare_file(&id, &f.path, &l.content_hash, &r.content_hash))
                    .collect::<Result<_>>()?,
                None => vec![],
            };
            if cli.json {
                return print_json(
                    &serde_json::json!({ "comparison": c, "upstream": upstream, "diffs": diffs }),
                );
            }

            let agents = q.agents();
            let n = c.versions.len();
            println!(
                "{} {}",
                st.bold(&c.name),
                st.dim(&if n == 1 {
                    "· every copy is identical".to_string()
                } else {
                    format!("· {n} different versions")
                })
            );
            let matching = |v: &SkillVersion| {
                upstream
                    .as_ref()
                    .is_some_and(|u| u.matching_hashes.contains(&v.content_hash))
            };
            for v in &c.versions {
                let mut badges = Vec::new();
                if v.newest {
                    badges.push(st.green("newest"));
                }
                if matching(v) {
                    badges.push(st.green("matches GitHub"));
                }
                if v.edited_since_install == Some(true) {
                    badges.push(st.yellow("edited since install"));
                }
                println!("\n  {}  {}", st.bold(&v.id), version_where(&q, &agents, v));
                println!(
                    "      {}{}",
                    st.dim(&format!(
                        "modified {} · {} file{}",
                        ago(v.modified_ms),
                        v.file_count,
                        if v.file_count == 1 { "" } else { "s" }
                    )),
                    if badges.is_empty() {
                        String::new()
                    } else {
                        format!("  {}", badges.join(" · "))
                    }
                );
                for l in &v.locations {
                    println!(
                        "      {}",
                        st.dim(&q.env.display(std::path::Path::new(&l.path)))
                    );
                }
            }
            if let Some(u) = upstream
                .as_ref()
                .filter(|u| u.status == UpstreamStatus::Unavailable)
            {
                println!(
                    "\n{}",
                    st.dim(&format!(
                        "Couldn't check GitHub: {}",
                        u.message.as_deref().unwrap_or("unavailable")
                    ))
                );
            }

            let changed: Vec<&FileCompare> = c
                .files
                .iter()
                .filter(|f| f.status != FileStatus::Same)
                .collect();
            let same = c.files.len() - changed.len();
            if !changed.is_empty() {
                println!(
                    "\n{}",
                    st.bold(&format!(
                        "{} differ{}{}",
                        if changed.len() == 1 {
                            "1 file".to_string()
                        } else {
                            format!("{} files", changed.len())
                        },
                        if changed.len() == 1 { "s" } else { "" },
                        if same > 0 {
                            format!(", {same} identical")
                        } else {
                            String::new()
                        }
                    ))
                );
                for f in &changed {
                    let (mark, note) = match f.status {
                        FileStatus::Partial => {
                            let has: Vec<&str> = c
                                .versions
                                .iter()
                                .zip(&f.variants)
                                .filter(|(_, x)| x.is_some())
                                .map(|(v, _)| v.id.as_str())
                                .collect();
                            (st.green("+"), format!("only in {}", has.join(", ")))
                        }
                        _ => (st.yellow("~"), "differs".to_string()),
                    };
                    println!("  {mark} {:<36} {}", f.path, st.dim(&note));
                }
            }
            let Some((l, r)) = pair else {
                println!("\nNothing to compare: all copies are identical.");
                return Ok(());
            };
            println!(
                "\n{}",
                st.dim(&format!(
                    "Comparing {} (-) with {} (+). Pick another pair with --from and --to.",
                    l.id, r.id
                ))
            );
            if diffs.is_empty() {
                println!(
                    "{} no file differs between {} and {}",
                    st.green("✓"),
                    l.id,
                    r.id
                );
            }
            for d in &diffs {
                println!();
                if d.content == FileContent::Binary {
                    println!(
                        "{}",
                        st.bold(&format!(
                            "Binary files {}/{p} and {}/{p} differ",
                            l.id,
                            r.id,
                            p = d.path
                        ))
                    );
                } else if d.content == FileContent::TooLarge {
                    println!(
                        "{}",
                        st.bold(&format!(
                            "{} is too large to compare ({} and {} KB; the limit is {} KB)",
                            d.path,
                            d.left_size.map_or(0, |n| n / 1024),
                            d.right_size.map_or(0, |n| n / 1024),
                            compare::MAX_DIFF_BYTES / 1024
                        ))
                    );
                } else if d.eol_only {
                    println!(
                        "{}",
                        st.bold(&format!("{}: only line endings differ", d.path))
                    );
                } else {
                    print_unified(&st, d, &l.id, &r.id);
                }
            }
            if c.versions.len() > 1 {
                println!(
                    "\n{}",
                    st.dim(&format!(
                        "To keep one everywhere: quiver adopt {id} --from <path>"
                    ))
                );
            }
        }
        Cmd::Universal { state } => {
            let mut q = q;
            match state.as_deref() {
                None => println!(
                    "Universal mode is {}",
                    if q.settings.universal {
                        st.green("on")
                    } else {
                        st.dim("off")
                    }
                ),
                Some(v @ ("on" | "off")) => {
                    let mut s = q.settings.clone();
                    s.universal = v == "on";
                    q.save_settings(s)?;
                    println!(
                        "Universal mode {}",
                        if v == "on" {
                            st.green("on")
                        } else {
                            st.dim("off")
                        }
                    );
                    if let Some(r) = q.auto_sync() {
                        println!(
                            "Synced: {} change(s), {} error(s)",
                            r.ok.len(),
                            r.errors.len()
                        );
                    }
                }
                Some(other) => anyhow::bail!("expected `on` or `off`, got `{other}`"),
            }
        }
        Cmd::Sources { ids, apply } => {
            let scan = q.find_sources(&ids);
            if cli.json && !apply {
                return print_json(&scan);
            }
            let found = &scan.matches;
            for m in found {
                let label = match m.confidence {
                    MatchConfidence::Exact => st.green("identical"),
                    MatchConfidence::SkillMd => st.green("same SKILL.md"),
                    MatchConfidence::Name => st.yellow("same name, differs"),
                };
                println!("{:<36} {:<40} {label}", st.bold(&m.id), m.source);
            }
            println!(
                "\n{} of the checked skills have a known source.",
                found.len()
            );
            if apply {
                let mut n = 0;
                for m in found
                    .iter()
                    .filter(|m| m.confidence > MatchConfidence::Name)
                {
                    match q.track_source(&m.id, &m.source, &m.skill_path) {
                        Ok(()) => n += 1,
                        Err(e) => println!("{} {}: {e:#}", st.red("✗"), m.id),
                    }
                }
                println!("{} now tracking {n} skill(s) for updates", st.green("✓"));
            } else if found.iter().any(|m| m.confidence > MatchConfidence::Name) {
                println!("Run `quiver sources --apply` to track the verified ones for updates.");
            }
        }
        Cmd::Search { query } => {
            let results = q.search(&query.join(" "))?;
            if cli.json {
                return print_json(&results);
            }
            for r in results {
                let installed = if r.installed {
                    st.green(" installed")
                } else {
                    String::new()
                };
                println!(
                    "{:<40} {:<36} {:>9} installs{installed}",
                    st.bold(&r.name),
                    st.dim(&r.source),
                    r.installs
                );
            }
        }
        Cmd::Pin {
            skill,
            name,
            git_ref,
            dir,
            agents,
            copy,
        } => {
            let mut q = q;
            let name = name.unwrap_or_else(|| format!("{skill}-pinned"));
            let req = PinRequest {
                project: project_dir(dir)?.to_string_lossy().into_owned(),
                skill,
                name: name.clone(),
                git_ref,
                agents,
                mode: if copy {
                    PinMode::Copy
                } else {
                    PinMode::Symlink
                },
            };
            let d = q.pin_create(&req)?;
            // So the app lists the project and the skill shows where it's pinned.
            let _ = q.project_add(&d.summary.path);
            let pin = d
                .pins
                .iter()
                .find(|p| p.name == name)
                .ok_or_else(|| anyhow::anyhow!("the pin was written but can't be read back"))?;
            if cli.json {
                return print_json(pin);
            }
            print_pinned(&st, &q, &d, pin);
        }
        Cmd::Unpin { name, dir } => {
            let d = q.pin_remove(&project_dir(dir)?.to_string_lossy(), &name)?;
            if cli.json {
                return print_json(&d);
            }
            println!(
                "{} unpinned {name} (folders moved to the {})",
                st.green("✓"),
                fsutil::TRASH_NAME
            );
            if d.pins.is_empty() {
                println!(
                    "{}",
                    st.dim(&format!("No pins left; {} was deleted.", pins::LOCK_FILE))
                );
            }
        }
        Cmd::Pins { dir, action } => {
            let project = project_dir(dir)?.to_string_lossy().into_owned();
            let d = match action {
                None => q.project_detail(&project)?,
                Some(PinsCmd::Verify) => unreachable!("handled before a Quiver exists"),
                Some(PinsCmd::Sync) => {
                    let broken: Vec<String> = q
                        .project_detail(&project)?
                        .pins
                        .iter()
                        .flat_map(|p| p.agents.iter().filter(|a| !a.ok).map(|a| a.dir.clone()))
                        .collect();
                    let d = q.pin_sync(&project)?;
                    if !cli.json {
                        let fixed: Vec<&String> = broken
                            .iter()
                            .filter(|dir| {
                                d.pins
                                    .iter()
                                    .flat_map(|p| &p.agents)
                                    .any(|a| &a.dir == *dir && a.ok)
                            })
                            .collect();
                        if fixed.is_empty() {
                            println!("{} nothing to repair", st.green("✓"));
                        }
                        for dir in fixed {
                            println!("{} repaired {dir}", st.green("✓"));
                        }
                        println!();
                    }
                    d
                }
                Some(PinsCmd::Update {
                    name,
                    git_ref,
                    accept,
                }) => {
                    if accept {
                        q.pin_accept(&project, &name)?
                    } else {
                        q.pin_update(&project, &name, git_ref.as_deref())?
                    }
                }
            };
            if cli.json {
                return print_json(&d.pins);
            }
            print_pins(&st, &d);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ago_reads_like_a_person() {
        let now = store::now_ms();
        assert_eq!(ago(None), "unknown");
        assert_eq!(ago(Some(now - 5_000)), "just now");
        assert_eq!(ago(Some(now - 3 * 86_400_000)), "3 days ago");
        assert_eq!(ago(Some(now - 86_400_000)), "1 day ago");
        assert_eq!(ago(Some(now - 2 * 3_600_000)), "2 hours ago");
    }

    #[test]
    fn diff_lines_are_plain_without_colour_and_mark_changes_with_it() {
        let off = Style { on: false };
        assert_eq!(
            diff_line(&off, "31", '-', "old line", &[(0, 3)]),
            "-old line"
        );
        let on = Style { on: true };
        // `old` is reverse-video red, the rest plain red.
        assert_eq!(
            diff_line(&on, "31", '-', "old line", &[(0, 3)]),
            "\x1b[31m-\x1b[0m\x1b[31;7mold\x1b[0m\x1b[31m line\x1b[0m"
        );
    }
}
