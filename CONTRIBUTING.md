# Contributing to Quiver

Thanks for helping! Quiver is small on purpose: a Rust core that does the real work and a thin UI on top.

## Getting started

```sh
git clone https://github.com/AnkushBL6/quiver && cd quiver
cargo test --workspace            # core + CLI tests
cd app && pnpm install && pnpm tauri dev
```

`pnpm dev` runs the UI in a browser against a stateful mock backend (`app/src/lib/mock.ts`). This is the fastest way to work on UI. Add `?demo=empty` for a first-run state.

## Adding or fixing an agent

Edit [`crates/quiver-core/agents.json`](crates/quiver-core/agents.json):

```json
{
  "id": "my-agent",
  "name": "My Agent",
  "globalDirs": ["~/.my-agent/skills"],
  "detect": ["~/.my-agent"],
  "detectBins": ["my-agent"],
  "projectDir": ".my-agent/skills",
  "tier": 3
}
```

- `globalDirs[0]` is where Quiver installs. Later entries are legacy or alternate dirs that are scanned but never written.
- `readDirs` lists extra dirs the agent reads (scanned, never written).
- Paths support `~`, `{XDG_CONFIG}` and env-relocatable homes such as `{CODEX_HOME}`. Write them with `/`; on Windows `~` is the user profile and separators are converted. Add a Windows-specific path only if the agent's own docs say it differs; don't guess.
- Please link the agent's docs in your PR, or show where its binary reads the path. We verify paths, we don't guess them.

Run `cargo test -p quiver-core` (the registry test checks ids and fields).

## Ground rules

- The canonical store (`~/.agents/skills`) is the source of truth; agent folders only receive links or copies.
- Never delete user data: use `fsutil::trash`, which moves things to the Trash (macOS) or Recycle Bin (Windows).
- Quiver runs on macOS and Windows. Don't use `std::os::unix` directly: make directory links with `fsutil::symlink_dir` / `fsutil::link_or_copy_dir` (symlink on Unix, junction on Windows), canonicalise with `fsutil::canonicalize` (no `\\?\` prefix), and start helper programs with `proc::command`. Test helpers must build paths and links in a way that works on both (see `tests/ops.rs`). CI runs the Rust tests on macOS, Linux and Windows.
- Stay compatible with the shared lockfile (`~/.agents/.skill-lock.json`, v3) and preserve unknown fields.
- New behavior in `quiver-core` needs a test in `crates/quiver-core/tests/ops.rs` (they run against a temp home).
- If you change `crates/quiver-core/src/model.rs`, update `app/src/lib/types.ts` to match.

## Commit style

Small, focused commits with imperative messages ("Add Kiro project dir", not "added stuff").
