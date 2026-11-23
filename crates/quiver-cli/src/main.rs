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
    /// Remove a skill everywhere (folders go to the Trash).
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

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e:#}");
        std::process::exit(1);
    }
}

fn print_json<T: serde::Serialize>(v: &T) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(v)?);
    Ok(())
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
    let q = match &cli.home {
        Some(h) => {
            std::fs::create_dir_all(h)?;
            let mut env = Env::isolated(std::fs::canonicalize(h)?);
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
                "{} removed {id} (folders moved to the Trash)",
                st.green("✓")
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
                    "  {} {c}: different copies exist; run `quiver show {c}` then `quiver adopt {c} --from <path>`",
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
    }
    Ok(())
}
