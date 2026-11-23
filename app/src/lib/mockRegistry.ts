// Generated from crates/quiver-core/agents.json for the browser mock. Do not edit by hand.

export interface RegistryAgent {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  dirs: string[];
  readDirs: string[];
  note: string | null;
}

export const REGISTRY: RegistryAgent[] = [
  {
    "id": "claude-code",
    "name": "Claude Code",
    "tier": 1,
    "dirs": [
      "~/.claude/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "codex",
    "name": "Codex",
    "tier": 1,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [
      "~/.codex/skills"
    ],
    "note": "Codex reads ~/.agents/skills (user) and $CODEX_HOME/skills (legacy)."
  },
  {
    "id": "antigravity",
    "name": "Antigravity",
    "tier": 1,
    "dirs": [
      "~/.gemini/config/skills",
      "~/.gemini/antigravity/skills",
      "~/.gemini/antigravity-cli/skills"
    ],
    "readDirs": [],
    "note": "Antigravity 2.x app and agy CLI read ~/.gemini/config/skills; older builds used ~/.gemini/antigravity/skills."
  },
  {
    "id": "cursor",
    "name": "Cursor",
    "tier": 1,
    "dirs": [
      "~/.cursor/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "gemini-cli",
    "name": "Gemini CLI",
    "tier": 1,
    "dirs": [
      "~/.gemini/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "github-copilot",
    "name": "GitHub Copilot",
    "tier": 1,
    "dirs": [
      "~/.copilot/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "opencode",
    "name": "OpenCode",
    "tier": 2,
    "dirs": [
      "~/.config/opencode/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "windsurf",
    "name": "Windsurf",
    "tier": 2,
    "dirs": [
      "~/.codeium/windsurf/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "droid",
    "name": "Droid",
    "tier": 2,
    "dirs": [
      "~/.factory/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "amp",
    "name": "Amp",
    "tier": 2,
    "dirs": [
      "~/.config/agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "kiro-cli",
    "name": "Kiro",
    "tier": 2,
    "dirs": [
      "~/.kiro/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "cline",
    "name": "Cline",
    "tier": 2,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "roo",
    "name": "Roo Code",
    "tier": 2,
    "dirs": [
      "~/.roo/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "kilo",
    "name": "Kilo Code",
    "tier": 2,
    "dirs": [
      "~/.kilo/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "continue",
    "name": "Continue",
    "tier": 2,
    "dirs": [
      "~/.continue/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "goose",
    "name": "Goose",
    "tier": 2,
    "dirs": [
      "~/.config/goose/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "qwen-code",
    "name": "Qwen Code",
    "tier": 2,
    "dirs": [
      "~/.qwen/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "warp",
    "name": "Warp",
    "tier": 2,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "zed",
    "name": "Zed",
    "tier": 2,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "grok",
    "name": "Grok Build",
    "tier": 2,
    "dirs": [
      "~/.grok/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "openhands",
    "name": "OpenHands",
    "tier": 2,
    "dirs": [
      "~/.openhands/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "junie",
    "name": "Junie",
    "tier": 2,
    "dirs": [
      "~/.junie/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "trae",
    "name": "Trae",
    "tier": 2,
    "dirs": [
      "~/.trae/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "augment",
    "name": "Augment",
    "tier": 2,
    "dirs": [
      "~/.augment/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "crush",
    "name": "Crush",
    "tier": 2,
    "dirs": [
      "~/.config/crush/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "adal",
    "name": "AdaL",
    "tier": 3,
    "dirs": [
      "~/.adal/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "aider-desk",
    "name": "AiderDesk",
    "tier": 3,
    "dirs": [
      "~/.aider-desk/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "astrbot",
    "name": "AstrBot",
    "tier": 3,
    "dirs": [
      "~/.astrbot/data/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "autohand-code",
    "name": "Autohand Code CLI",
    "tier": 3,
    "dirs": [
      "~/.autohand/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "codestudio",
    "name": "Code Studio",
    "tier": 3,
    "dirs": [
      "~/.codestudio/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "codearts-agent",
    "name": "CodeArts Agent",
    "tier": 3,
    "dirs": [
      "~/.codeartsdoer/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "codebuddy",
    "name": "CodeBuddy",
    "tier": 3,
    "dirs": [
      "~/.codebuddy/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "codemaker",
    "name": "Codemaker",
    "tier": 3,
    "dirs": [
      "~/.codemaker/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "command-code",
    "name": "Command Code",
    "tier": 3,
    "dirs": [
      "~/.commandcode/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "cortex",
    "name": "Cortex Code",
    "tier": 3,
    "dirs": [
      "~/.snowflake/cortex/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "deepagents",
    "name": "Deep Agents",
    "tier": 3,
    "dirs": [
      "~/.deepagents/agent/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "devin",
    "name": "Devin for Terminal",
    "tier": 3,
    "dirs": [
      "~/.config/devin/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "dexto",
    "name": "Dexto",
    "tier": 3,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "firebender",
    "name": "Firebender",
    "tier": 3,
    "dirs": [
      "~/.firebender/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "forgecode",
    "name": "ForgeCode",
    "tier": 3,
    "dirs": [
      "~/.forge/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "fx",
    "name": "fx",
    "tier": 3,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "hermes-agent",
    "name": "Hermes Agent",
    "tier": 3,
    "dirs": [
      "~/.hermes/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "bob",
    "name": "IBM Bob",
    "tier": 3,
    "dirs": [
      "~/.bob/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "iflow-cli",
    "name": "iFlow CLI",
    "tier": 3,
    "dirs": [
      "~/.iflow/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "inference-sh",
    "name": "inference.sh",
    "tier": 3,
    "dirs": [
      "~/.inferencesh/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "jazz",
    "name": "Jazz",
    "tier": 3,
    "dirs": [
      "~/.jazz/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "kimchi",
    "name": "Kimchi",
    "tier": 3,
    "dirs": [
      "~/.config/kimchi/harness/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "kimi-code-cli",
    "name": "Kimi Code CLI",
    "tier": 3,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "kode",
    "name": "Kode",
    "tier": 3,
    "dirs": [
      "~/.kode/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "lingma",
    "name": "Lingma",
    "tier": 3,
    "dirs": [
      "~/.lingma/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "loaf",
    "name": "Loaf",
    "tier": 3,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "mcpjam",
    "name": "MCPJam",
    "tier": 3,
    "dirs": [
      "~/.mcpjam/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "minimax-code",
    "name": "MiniMax Code",
    "tier": 3,
    "dirs": [
      "~/.minimax/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "mistral-vibe",
    "name": "Mistral Vibe",
    "tier": 3,
    "dirs": [
      "~/.vibe/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "moxby",
    "name": "Moxby",
    "tier": 3,
    "dirs": [
      "~/.moxby/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "mux",
    "name": "Mux",
    "tier": 3,
    "dirs": [
      "~/.mux/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "neovate",
    "name": "Neovate",
    "tier": 3,
    "dirs": [
      "~/.neovate/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "ona",
    "name": "Ona",
    "tier": 3,
    "dirs": [
      "~/.ona/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "openclaw",
    "name": "OpenClaw",
    "tier": 3,
    "dirs": [
      "~/.openclaw/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "pi",
    "name": "Pi",
    "tier": 3,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "pochi",
    "name": "Pochi",
    "tier": 3,
    "dirs": [
      "~/.pochi/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "posit-assistant",
    "name": "Posit Assistant",
    "tier": 3,
    "dirs": [
      "~/.posit/assistant/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "qoder",
    "name": "Qoder",
    "tier": 3,
    "dirs": [
      "~/.qoder/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "reasonix",
    "name": "Reasonix",
    "tier": 3,
    "dirs": [
      "~/.reasonix/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "rovodev",
    "name": "Rovo Dev",
    "tier": 3,
    "dirs": [
      "~/.rovodev/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "sarvam-code",
    "name": "Sarvam Code",
    "tier": 3,
    "dirs": [
      "~/.agents/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "tabnine-cli",
    "name": "Tabnine CLI",
    "tier": 3,
    "dirs": [
      "~/.tabnine/agent/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "terramind",
    "name": "Terramind",
    "tier": 3,
    "dirs": [
      "~/.terramind/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "tinycloud",
    "name": "Tinycloud",
    "tier": 3,
    "dirs": [
      "~/.tinycloud/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "zcode",
    "name": "ZCode",
    "tier": 3,
    "dirs": [
      "~/.zcode/skills"
    ],
    "readDirs": [],
    "note": null
  },
  {
    "id": "zencoder",
    "name": "Zencoder / Zenflow",
    "tier": 3,
    "dirs": [
      "~/.zencoder/skills"
    ],
    "readDirs": [],
    "note": null
  }
];
