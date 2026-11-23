import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FolderOpen, KeyRound, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage, isTauri, pickDirectory, pickSource } from "../lib/api";
import type { Settings } from "../lib/types";
import { cx, tildify } from "../lib/ui";
import { useActions, useData } from "../state/store";
import { AgentAvatar, GitHubMark, Logo } from "../components/identity";
import { Button, Checkbox, Segmented, Select, Skeleton, Switch, TextField, Toolbar, ToolbarTitle } from "../components/ui";
import { useConfirm } from "../components/overlay";

const REPO_URL = "https://github.com/AnkushBL6/quiver";

export function SettingsView() {
  const { settings, inventory } = useData();
  const { saveSettings } = useActions();

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar>
        <ToolbarTitle>Settings</ToolbarTitle>
      </Toolbar>
      <div className="scroll min-h-0 flex-1 bg-surface">
        <div className="mx-auto max-w-[680px] px-6 py-6">
          {!settings || !inventory ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-[120px] rounded-[10px]" />
              <Skeleton className="h-[260px] rounded-[10px]" />
            </div>
          ) : (
            <SettingsForm settings={settings} save={saveSettings} />
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsForm({ settings, save }: { settings: Settings; save: (s: Settings) => Promise<void> }) {
  const { inventory } = useData();
  const set = (patch: Partial<Settings>) => void save({ ...settings, ...patch });
  const detected = useMemo(() => inventory!.agents.filter((a) => a.detected), [inventory]);
  const allDefault = settings.defaultAgents.length === 0;

  const toggleDefault = (id: string, on: boolean) => {
    const base = allDefault ? detected.map((a) => a.id) : settings.defaultAgents;
    const next = on ? [...new Set([...base, id])] : base.filter((x) => x !== id);
    set({ defaultAgents: next.length === detected.length ? [] : next });
  };

  return (
    <>
      <MySkillsGroup settings={settings} save={save} />

      <Group
        title="Universal mode"
        description="Keep every skill in every agent automatically. New installs go everywhere, skills that appear in one agent's folder are shared with the rest, and newly installed agents get your whole library. Switching a skill off for one agent makes an exception."
      >
        <Field label="Make every skill universal" hint={settings.universal ? "On. Quiver keeps all agents in sync in the background." : "Off. You choose agents per skill."}>
          <Switch checked={settings.universal} onChange={(v) => set({ universal: v })} label="Universal mode" />
        </Field>
      </Group>

      <Group title="General">
        <Field label="Check for updates automatically" hint="Compare installed skills with their GitHub or git source.">
          <Switch checked={settings.autoCheckUpdates} onChange={(v) => set({ autoCheckUpdates: v })} label="Check for updates automatically" />
        </Field>
        <Field label="Check every" disabled={!settings.autoCheckUpdates}>
          <Select<number>
            label="Check every"
            value={settings.checkIntervalHours}
            disabled={!settings.autoCheckUpdates}
            onChange={(v) => set({ checkIntervalHours: v })}
            className="w-[110px]"
            options={[1, 3, 6, 12, 24, 72, 168].map((h) => ({
              value: h,
              label: h === 1 ? "Hour" : h < 24 ? `${h} hours` : h === 24 ? "Day" : h === 168 ? "Week" : `${h / 24} days`,
            }))}
          />
        </Field>
        <Field label="Include plugin skills" hint="Show skills that agent plugins provide. They're read-only.">
          <Switch checked={settings.scanPlugins} onChange={(v) => set({ scanPlugins: v })} label="Include plugin skills" />
        </Field>
        <Field
          label="Link skills to new agents"
          hint={settings.universal ? "Included in Universal mode." : "When Quiver detects a newly installed agent, link every managed skill into it."}
        >
          <Switch
            checked={settings.universal || settings.autoLinkNewAgents}
            disabled={settings.universal}
            onChange={(v) => set({ autoLinkNewAgents: v })}
            label="Link skills to new agents"
          />
        </Field>
      </Group>

      <Group
        title="Agents"
        description="Default agents get new skills when you install. Hidden agents are left out of the Library and Matrix. Copy mode writes real folders for agents that don't follow symlinks."
      >
        <div className="flex h-[26px] items-center gap-3 border-b border-line px-3.5 text-[11px] text-fg-2">
          <span className="flex-1">Agent</span>
          <span className="w-[56px] text-center">Default</span>
          <span className="w-[128px] text-center">Install as</span>
          <span className="w-[48px] text-center">Show</span>
        </div>
        {detected.map((a) => {
          const isDefault = allDefault || settings.defaultAgents.includes(a.id);
          const hidden = settings.hiddenAgents.includes(a.id);
          return (
            <div key={a.id} className="flex h-10 items-center gap-3 border-b border-line px-3.5 last:border-b-0">
              <AgentAvatar id={a.id} name={a.name} size={20} muted={hidden} />
              <span className={cx("min-w-0 flex-1 truncate text-[13px]", hidden && "text-fg-3")}>{a.name}</span>
              <span className="flex w-[56px] justify-center">
                <Checkbox checked={isDefault} onChange={(v) => toggleDefault(a.id, v)} label={`${a.name} is a default agent`} />
              </span>
              <span className="flex w-[128px] justify-center">
                {a.readsCanonical ? (
                  <span className="text-[11.5px] text-fg-3">reads store</span>
                ) : (
                  <Segmented
                    size="sm"
                    value={settings.linkModes[a.id] ?? "symlink"}
                    onChange={(m) => {
                      const linkModes = { ...settings.linkModes };
                      if (m === "symlink") delete linkModes[a.id];
                      else linkModes[a.id] = m;
                      set({ linkModes });
                    }}
                    options={[
                      { value: "symlink", label: "Link" },
                      { value: "copy", label: "Copy" },
                    ]}
                  />
                )}
              </span>
              <span className="flex w-[48px] justify-center">
                <Switch
                  size="sm"
                  checked={!hidden}
                  label={`Show ${a.name}`}
                  onChange={(v) =>
                    set({ hiddenAgents: v ? settings.hiddenAgents.filter((x) => x !== a.id) : [...settings.hiddenAgents, a.id] })
                  }
                />
              </span>
            </div>
          );
        })}
      </Group>

      <CustomAgents settings={settings} save={save} />
      <GitHubToken settings={settings} />
      <About canonicalDir={inventory!.canonicalDir} />
    </>
  );
}

function CustomAgents({ settings, save }: { settings: Settings; save: (s: Settings) => Promise<void> }) {
  const [name, setName] = useState("");
  const [dir, setDir] = useState("");
  const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const taken = settings.customAgents.some((c) => c.id === id);
  const valid = id.length > 0 && dir.trim().length > 1 && !taken;

  const add = () => {
    if (!valid) return;
    void save({ ...settings, customAgents: [...settings.customAgents, { id, name: name.trim(), skillsDir: dir.trim() }] });
    setName("");
    setDir("");
    toast.success(`Added ${name.trim()}`);
  };

  return (
    <Group title="Custom agents" description="Point Quiver at any other folder an agent reads skills from.">
      {settings.customAgents.map((c) => (
        <div key={c.id} className="flex h-10 items-center gap-3 border-b border-line px-3.5">
          <AgentAvatar id={c.id} name={c.name} size={20} />
          <span className="w-[160px] shrink-0 truncate text-[13px]">{c.name}</span>
          <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-fg-2">{tildify(c.skillsDir)}</span>
          <Button
            size="sm"
            variant="dangerGhost"
            icon={<Trash2 size={12} />}
            onClick={() => void save({ ...settings, customAgents: settings.customAgents.filter((x) => x.id !== c.id) })}
          >
            Remove
          </Button>
        </div>
      ))}
      <form
        className="flex items-center gap-2 px-3.5 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <TextField value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" className="w-[150px]" aria-label="Agent name" />
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <TextField value={dir} onChange={(e) => setDir(e.target.value)} placeholder="~/.my-agent/skills" mono className="min-w-0 flex-1" aria-label="Skills folder" />
          <Button
            icon={<FolderOpen size={13} />}
            onClick={async () => {
              const p = await pickSource("folder").catch(() => null);
              if (p) setDir(isTauri ? p : "~/.my-agent/skills");
            }}
            aria-label="Choose folder"
          />
        </div>
        <Button type="submit" variant="secondary" icon={<Plus size={13} />} disabled={!valid}>
          Add
        </Button>
      </form>
      {taken && <div className="px-3.5 pb-3 text-[12px] text-red">An agent with this name already exists.</div>}
    </Group>
  );
}

const TOKEN_SOURCE: Record<string, string> = {
  keychain: "Using the token saved in your macOS Keychain.",
  env: "Using GITHUB_TOKEN from the environment.",
  gh: "Using your GitHub CLI (gh) login.",
};

function GitHubToken({ settings }: { settings: Settings }) {
  const { setSettings } = useActions();
  const confirm = useConfirm();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const source = settings.githubTokenSource;

  const saveToken = async (value: string | null) => {
    setBusy(true);
    try {
      setSettings(await api.setGithubToken(value));
      setToken("");
      toast.success(value ? "Token saved to Keychain" : "Token removed");
    } catch (e) {
      toast.error("Couldn't save the token", { description: errorMessage(e) });
    }
    setBusy(false);
  };

  return (
    <Group title="GitHub" description="A token raises the API limit from 60 to 5,000 requests an hour and lets Quiver read private repositories.">
      <div className="px-3.5 py-3">
        <div className="flex items-center gap-2 text-[12.5px]">
          <span className={cx("h-2 w-2 rounded-full", source ? "bg-green" : "bg-fg-3")} />
          <span className={source ? "text-fg" : "text-fg-2"}>
            {source ? (TOKEN_SOURCE[source] ?? `Using a token from ${source}.`) : "No token. Public repositories only, 60 requests an hour."}
          </span>
          {source === "keychain" && (
            <Button
              size="sm"
              variant="dangerGhost"
              className="ml-auto"
              onClick={async () => {
                if (await confirm({ title: "Remove the GitHub token?", message: "It's deleted from your Keychain.", confirmLabel: "Remove", destructive: true }))
                  void saveToken(null);
              }}
            >
              Remove
            </Button>
          )}
        </div>
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (token.trim()) void saveToken(token.trim());
          }}
        >
          <div className="relative min-w-0 flex-1">
            <KeyRound size={13} className="pointer-events-none absolute top-[7px] left-2 text-fg-3" />
            <TextField
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={source === "keychain" ? "Replace token" : "ghp_… or github_pat_…"}
              mono
              className="w-full pl-7"
              autoComplete="off"
              aria-label="GitHub token"
            />
          </div>
          <Button type="submit" variant="secondary" disabled={!token.trim()} loading={busy}>
            Save to Keychain
          </Button>
        </form>
      </div>
    </Group>
  );
}

function About({ canonicalDir }: { canonicalDir: string }) {
  const [version, setVersion] = useState("0.1.0");
  useEffect(() => {
    if (!isTauri) return;
    void import("@tauri-apps/api/app").then((m) => m.getVersion().then(setVersion)).catch(() => {});
  }, []);
  const openUrl = (url: string) => void api.openPath(url).catch(() => window.open(url, "_blank"));
  return (
    <Group title="About">
      <div className="flex items-center gap-3.5 px-3.5 py-4">
        <Logo size={40} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            Quiver <span className="font-normal text-fg-3">{version}</span>
          </div>
          <div className="text-[12px] text-fg-2">One library of agent skills for every coding agent.</div>
          <div className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-fg-3">
            Canonical store: {tildify(canonicalDir)}
            <button type="button" className="rounded p-0.5 hover:bg-hover hover:text-fg-2" aria-label="Reveal canonical store" onClick={() => void api.reveal(canonicalDir)}>
              <FolderOpen size={11} />
            </button>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <Button size="sm" icon={<GitHubMark size={12} />} onClick={() => openUrl(REPO_URL)}>
            GitHub
          </Button>
          <span className="text-[11px] text-fg-3">MIT License</span>
        </div>
      </div>
    </Group>
  );
}

function Group({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="mb-7">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {description && <p className="mt-0.5 text-[12px] leading-relaxed text-fg-2">{description}</p>}
      <div className="mt-2 overflow-hidden rounded-[10px] border-[0.5px] border-line-2 bg-[color-mix(in_srgb,var(--q-surface-2)_60%,var(--q-surface))]">{children}</div>
    </section>
  );
}

function Field({ label, hint, children, disabled }: { label: string; hint?: string; children: ReactNode; disabled?: boolean }) {
  return (
    <div className={cx("flex min-h-[44px] items-center gap-4 border-b border-line px-3.5 py-2 last:border-b-0", disabled && "opacity-55")}>
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">{label}</div>
        {hint && <div className="text-[11.5px] text-fg-3">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

function MySkillsGroup({ settings, save }: { settings: Settings; save: (s: Settings) => Promise<void> }) {
  const { mySkills, editors } = useData();
  const { refreshMySkills, rescan } = useActions();
  const confirm = useConfirm();
  const dir = settings.mySkillsDir || "~/Skills";

  const choose = async () => {
    const p = await pickDirectory("Choose the folder for your own skills").catch(() => null);
    if (!p) return;
    const next = tildify(p);
    if (next === dir) return;
    const ok = await confirm({
      title: `Use ${next} for your skills?`,
      message: `Quiver links the skills in ${next} into every agent. Skills already in ${dir} stay where they are; move them yourself if you want them in the new folder.`,
      confirmLabel: "Use Folder",
    });
    if (!ok) return;
    await save({ ...settings, mySkillsDir: next });
    await Promise.all([refreshMySkills(), rescan({ quiet: true })]);
  };

  const editorOptions = [
    { value: "", label: "Automatic" },
    ...(editors ?? []).map((e) => ({ value: e.name, label: e.name })),
  ];
  if (settings.editor && !editors?.some((e) => e.name === settings.editor)) editorOptions.push({ value: settings.editor, label: settings.editor });

  return (
    <Group
      title="My Skills"
      description="Skills you write live in a folder you own, versioned with git. Every agent sees them and updates never touch them."
    >
      <Field
        label="Folder"
        hint={
          mySkills
            ? mySkills.problem
              ? mySkills.problem
              : !mySkills.exists
              ? "Doesn't exist yet. It's created with your first skill."
              : mySkills.isRepo
                ? `Git repository${mySkills.branch ? ` on ${mySkills.branch}` : ""}${mySkills.githubRepo ? ` · ${mySkills.githubRepo}` : ""}`
                : mySkills.gitAvailable
                  ? "Not a git repository."
                  : "Git isn't installed."
            : undefined
        }
      >
        <span className="max-w-[220px] truncate font-mono text-[12px] text-fg-2" title={mySkills?.dir}>
          {dir}
        </span>
        {mySkills?.exists && (
          <Button size="md" onClick={() => void api.reveal(mySkills.dir).catch((e) => toast.error(errorMessage(e)))}>
            Reveal
          </Button>
        )}
        <Button size="md" onClick={() => void choose()}>
          Choose…
        </Button>
      </Field>
      <Field label="Editor" hint={`Used by “Edit in…” for your skills.${!settings.editor && editors?.length ? ` Automatic picks ${editors[0].name}.` : ""}`}>
        <Select<string>
          label="Editor"
          value={settings.editor ?? ""}
          onChange={(v) => void save({ ...settings, editor: v || null })}
          className="w-[190px]"
          options={editorOptions}
        />
      </Field>
    </Group>
  );
}
