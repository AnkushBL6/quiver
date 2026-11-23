<p align="center">
  <img src="assets/icon.png" width="128" height="128" alt="Quiver icon">
</p>

<h1 align="center">Quiver</h1>

<p align="center">
  <b>One skill library for every AI coding agent.</b><br>
  Install a skill once and Claude Code, Codex, Antigravity, Cursor, Gemini CLI, Copilot and 60+ more agents all see it.
</p>

<p align="center">
  <a href="https://quiver-five-gamma.vercel.app">Website</a> ·
  <a href="https://github.com/AnkushBL6/quiver/releases/latest">Download for macOS</a> ·
  <a href="#cli">CLI</a> ·
  <a href="#supported-agents">Supported agents</a> ·
  <a href="#how-it-works">How it works</a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot-dark.png">
    <img src="assets/screenshot-light.png" alt="Quiver: the skill library with per-agent visibility" width="900">
  </picture>
</p>

---

<p align="center"><img src="assets/demo.gif" alt="Make everything universal: the Matrix filling in" width="760"></p>

## Why

Every coding agent reads [Agent Skills](https://agentskills.io) (folders with a `SKILL.md`) from **its own folder**: `~/.claude/skills`, `~/.gemini/config/skills`, `~/.cursor/skills`, `~/.factory/skills`, and so on. Install a skill for one agent and the others never see it. Update it in one place and the copies drift apart. After a few months you have dozens of duplicates, broken symlinks and skills stranded in a single tool.

Quiver fixes that:

- **Install once, use everywhere.** Skills live in one shared store and are linked into every agent you use.
- **Universal mode.** Turn it on once and Quiver keeps every skill in every agent by itself. New installs go everywhere, a skill dropped into any one agent's folder is shared with the rest, and newly installed agents get your whole library. No per-agent checkboxes; switch a skill off for one agent only if you want an exception.
- **Your own skills, kept apart.** Skills you write live in `~/Skills`, a git repo you own. Quiver links them into every agent, never "updates" them from anywhere, shows uncommitted changes, and commits, pulls and pushes for you. Drop a folder into `~/Skills` and every agent sees it. Fork any installed skill with **Make it mine** to customise it without upstream updates overwriting your edits.
- **See everything.** A single library of every skill on your machine, with a matrix showing which agent sees what.
- **Make existing skills universal.** One click adopts skills that are stuck in one agent's folder and shares them with all the others.
- **Updates that actually work.** Quiver checks GitHub sources (one API call per repo), follows skills that moved upstream, and warns before overwriting your local edits.
- **Find lost sources.** Skills copied in by hand have no upstream, so they never update. Quiver finds where each one came from and verifies it against the repo's git tree hash, so it reports "identical to anthropics/skills" as a fact, not a guess. Then it tracks them for updates.
- **Health checks.** Finds broken links, conflicting copies and malformed `SKILL.md` frontmatter, and fixes them.
- **Install from anywhere.** `owner/repo`, GitHub URLs (tree/blob), skills.sh links, any git URL (GitLab, Bitbucket, SSH), local folders and `.zip` files. You can also drag and drop them onto the window.
- **Discover.** Search the [skills.sh](https://skills.sh) directory from inside the app.
- **Safe by design.** Nothing is deleted outright: replaced folders go to the macOS Trash, and every download is verified against GitHub's git blob SHA-1.
- **Fast and small.** The core is Rust and the app is built with Tauri; Quiver.app is under 7 MB. It scans 200+ skills across 70 agents in about 80 ms.

## How it works

```
                    ~/.agents/skills/            ← canonical store (one real copy)
                    ├── pdf/
                    ├── frontend-design/
                    └── my-skill/
                          ▲   ▲   ▲
         symlink ─────────┘   │   └───────── symlink
~/.claude/skills/pdf    ~/.gemini/config/skills/pdf    ~/.cursor/skills/pdf   …
```

- The canonical store is `~/.agents/skills`, the same location the [`skills` CLI](https://github.com/vercel-labs/skills) uses. Codex, Cline, Warp, Zed, Pi, Kimi and other "universal" agents read it **natively**, so they need no links at all.
- Every other agent gets a relative symlink in its own skills folder. Agents that don't follow symlinks can be switched to **copy mode** in Settings, and Quiver keeps those copies in sync.
- Quiver reads and writes the shared lockfile `~/.agents/.skill-lock.json` (v3) and preserves fields it doesn't know about, so it works side by side with `npx skills`.
- Your own skills live in `~/Skills/<name>` (configurable). The store entry `~/.agents/skills/<name>` is a symlink to it, so agents see it through the same links as everything else while the source of truth stays in your repo.
- Quiver-only state (install hashes for local-edit detection, agents you hid a skill from, update cache) lives in `~/.quiver/`. Your GitHub token, if you add one, is stored in the macOS Keychain.

## Install

**macOS app:** download the `.dmg` from [Releases](https://github.com/AnkushBL6/quiver/releases/latest) (universal: Apple Silicon and Intel, macOS 12+).

**CLI:**

```sh
cargo install --git https://github.com/AnkushBL6/quiver quiver-cli
```

## CLI

```sh
quiver list                       # every skill and how many agents see it
quiver agents [--all]             # detected agents and their skill folders
quiver show <skill>               # details, locations, per-agent visibility
quiver install anthropics/skills --skill pdf
quiver install https://github.com/owner/repo/tree/main/skills/foo
quiver install ./my-skills        # local folder, .zip, or any git URL
quiver adopt <skill>              # make a stranded skill universal
quiver link <skill> <agent>       # / unlink
quiver outdated && quiver update  # check and apply updates
quiver doctor [--apply]           # find and fix broken links, missing links, unmanaged skills
quiver universal on               # keep every skill in every agent automatically
quiver search <query>             # search skills.sh
quiver new <name> -d "…"          # create a skill of your own in ~/Skills
quiver mine                       # your skills: git status, last commit
quiver mine add <skill>           # make an installed skill yours (stops upstream updates)
quiver mine commit -m "…"         # / quiver mine push / quiver mine pull
quiver edit <skill>               # open in your editor
quiver list --mine
quiver sources [--apply]          # find (and track) the upstream of skills with no source
```

Every command accepts `--json`.

## Supported agents

Quiver ships with a registry of **71 agents** ([`crates/quiver-core/agents.json`](crates/quiver-core/agents.json)), including:

Claude Code (and extra `CLAUDE_CONFIG_DIR` profiles) · Codex · Antigravity (app and `agy` CLI) · Cursor · Gemini CLI · GitHub Copilot · OpenCode · Windsurf · Factory Droid · Amp · Kiro · Cline · Roo Code · Kilo Code · Continue · Goose · Qwen Code · Warp · Zed · Grok Build · OpenHands · Junie · Trae · Augment · Crush · Devin · Hermes · Pi · Kimi Code · Qoder · Mistral Vibe · and many more.

Paths come from the `skills` CLI's agent table and were **verified against the installed agent binaries** (Antigravity 2.x, for example, reads `~/.gemini/config/skills`, not the older `~/.gemini/antigravity/skills`). If an agent is missing or a path changed, edit `agents.json` and open a PR, or add a custom agent in Settings.

## Development

Requirements: Rust (stable), Node 22+, pnpm, and Xcode Command Line Tools.

```sh
cd app
pnpm install
pnpm tauri dev          # run the app
pnpm dev                # UI only, in the browser, against a realistic mock backend
cargo test --workspace  # core tests (uses a fake home directory)
```

Project layout:

```
crates/quiver-core   Rust library: agent registry, scanner, linker, installer, updater
crates/quiver-cli    `quiver` command-line tool
app/                 Tauri 2 desktop app (React + TypeScript UI, app/src-tauri = Rust shell)
website/             Project website
```

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- Project-level skills (`.claude/skills`, `.agents/skills` in repos)
- `quiver://` deep links for one-click installs from websites
- Self-updating app (Tauri updater) and Homebrew cask
- Windows and Linux builds (the core is already cross-platform)
- Menu bar mode with update notifications

## License

[MIT](LICENSE)
