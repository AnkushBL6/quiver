import { useMemo, useState } from "react";
import { BookOpenCheck, ChevronRight, EyeOff, FolderOpen, Info, Users } from "lucide-react";
import { toast } from "sonner";
import { api, errorMessage } from "../lib/api";
import type { AgentInfo, LinkMode } from "../lib/types";
import { cx, tildify } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { AgentAvatar } from "../components/identity";
import { EmptyState, IconButton, Meter, SearchField, Segmented, Skeleton, Switch, Toolbar, ToolbarTitle, Tooltip } from "../components/ui";

export function AgentsView() {
  const { inventory, settings } = useData();
  const { saveSettings } = useActions();
  const { go } = useNav();
  const [showMissing, setShowMissing] = useState(false);
  const [missingQuery, setMissingQuery] = useState("");

  const detected = useMemo(
    () => (inventory?.agents ?? []).filter((a) => a.detected).sort((a, b) => a.tier - b.tier || b.skillCount - a.skillCount),
    [inventory],
  );
  const missing = useMemo(
    () => (inventory?.agents ?? []).filter((a) => !a.detected).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)),
    [inventory],
  );
  const total = inventory?.skills.filter((s) => !s.plugin).length ?? 0;

  const setHidden = (a: AgentInfo, hidden: boolean) => {
    if (!settings) return;
    const set = new Set(settings.hiddenAgents);
    if (hidden) set.add(a.id);
    else set.delete(a.id);
    void saveSettings({ ...settings, hiddenAgents: [...set] });
  };
  const setMode = (a: AgentInfo, mode: LinkMode) => {
    if (!settings) return;
    const linkModes = { ...settings.linkModes };
    if (mode === "symlink") delete linkModes[a.id];
    else linkModes[a.id] = mode;
    void saveSettings({ ...settings, linkModes });
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar>
        <ToolbarTitle sub={inventory ? `${detected.length} detected · ${missing.length} not detected` : undefined}>Agents</ToolbarTitle>
      </Toolbar>
      <div className="scroll min-h-0 flex-1 bg-surface">
        <div className="mx-auto max-w-[860px] px-6 py-5">
          {!inventory ? (
            <Skeleton className="h-[420px] rounded-[10px]" />
          ) : detected.length === 0 ? (
            <EmptyState icon={<Users />} title="No Agents Detected">
              Quiver looks for {inventory.agents.length} coding agents in their usual folders. Install one, or add a custom agent in Settings.
            </EmptyState>
          ) : (
            <div className="overflow-hidden rounded-[10px] border-[0.5px] border-line-2 bg-[var(--q-surface)]">
              {detected.map((a) => (
                <AgentRow
                  key={a.id}
                  agent={a}
                  total={total}
                  onOpen={() => go("library", { agentFilter: a.id, filter: "all", selectedId: null })}
                  onHide={(h) => setHidden(a, h)}
                  onMode={(m) => setMode(a, m)}
                />
              ))}
            </div>
          )}

          {inventory && missing.length > 0 && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowMissing((s) => !s)}
                className="-ml-1 flex items-center gap-1 rounded px-1 py-1 text-[12px] font-semibold text-fg-2 hover:text-fg"
                aria-expanded={showMissing}
              >
                <ChevronRight size={11} strokeWidth={2.6} className={cx("text-fg-3 transition-transform duration-150", showMissing && "rotate-90")} />
                Not Detected <span className="font-normal text-fg-3">{missing.length}</span>
              </button>
              {showMissing && (
                <div className="anim-fade mt-2">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <p className="text-[12px] text-fg-3">
                      Quiver starts linking skills to these as soon as their folders appear
                      {settings?.autoLinkNewAgents ? " (auto-link is on)." : "."}
                    </p>
                    <SearchField value={missingQuery} onChange={setMissingQuery} placeholder="Filter" width={180} aria-label="Filter undetected agents" />
                  </div>
                  <div className="overflow-hidden rounded-[10px] border-[0.5px] border-line-2">
                    {missing
                      .filter((a) => !missingQuery || a.name.toLowerCase().includes(missingQuery.toLowerCase()))
                      .map((a, i) => (
                        <div key={a.id} className={cx("flex h-[34px] items-center gap-3 px-3", i % 2 === 1 && "bg-zebra")}>
                          <AgentAvatar id={a.id} name={a.name} size={18} muted />
                          <span className="w-[180px] shrink-0 truncate text-[12.5px] text-fg-2">{a.name}</span>
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-fg-3">{tildify(a.skillsDir)}</span>
                          {a.readsCanonical && <span className="text-[11px] text-fg-3">Reads the store</span>}
                          {a.tier === 1 && <span className="text-[11px] text-fg-3">Popular</span>}
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AgentRow({
  agent,
  total,
  onOpen,
  onHide,
  onMode,
}: {
  agent: AgentInfo;
  total: number;
  onOpen: () => void;
  onHide: (hidden: boolean) => void;
  onMode: (m: LinkMode) => void;
}) {
  return (
    <div className="flex min-h-[54px] items-center gap-3 border-b border-line px-3.5 py-2 last:border-b-0">
      <button type="button" onClick={onOpen} className="group flex min-w-0 flex-1 items-center gap-3 text-left" aria-label={`Show ${agent.name}'s skills`}>
        <span className={cx(!agent.enabled && "opacity-50")}>
          <AgentAvatar id={agent.id} name={agent.name} size={32} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className={cx("truncate text-[13px] font-medium", !agent.enabled && "text-fg-2")}>{agent.name}</span>
            {agent.custom && <span className="text-[11px] text-fg-3">Custom</span>}
            {!agent.enabled && (
              <span className="inline-flex items-center gap-0.5 text-[11px] text-fg-3">
                <EyeOff size={10} /> Hidden
              </span>
            )}
            {agent.note && (
              <Tooltip content={agent.note}>
                <Info size={12} className="text-fg-3" />
              </Tooltip>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[11.5px] text-fg-2">
            <Meter value={agent.skillCount} max={total} />
            <span className="shrink-0 tabular-nums group-hover:text-accent-text">
              {agent.skillCount} of {total} skills
            </span>
            <span className="min-w-0 truncate font-mono text-[10.5px] text-fg-3" title={agent.skillsDir}>
              {tildify(agent.skillsDir)}
            </span>
          </div>
        </div>
      </button>
      <IconButton label="Reveal in Finder" onClick={() => void api.reveal(agent.skillsDir).catch((e) => toast.error(errorMessage(e)))}>
        <FolderOpen size={14} strokeWidth={1.8} />
      </IconButton>
      <div className="flex w-[124px] shrink-0 justify-end">
        {agent.readsCanonical ? (
          <Tooltip content={`${agent.name} reads ~/.agents/skills directly, so every managed skill is visible without links.`}>
            <span className="inline-flex items-center gap-1 text-[11.5px] text-fg-3">
              <BookOpenCheck size={12} /> Reads the store
            </span>
          </Tooltip>
        ) : (
          <Segmented<LinkMode>
            size="sm"
            label={`${agent.name} install mode`}
            value={agent.linkMode}
            onChange={onMode}
            options={[
              { value: "symlink", label: "Symlink", title: "Link to ~/.agents/skills" },
              { value: "copy", label: "Copy", title: "Write real folders (for agents that don't follow symlinks)" },
            ]}
          />
        )}
      </div>
      <Tooltip content={agent.enabled ? "Shown in Library and Matrix" : "Hidden from Library and Matrix"}>
        <span className="flex">
          <Switch checked={agent.enabled} onChange={(v) => onHide(!v)} label={`Show ${agent.name}`} />
        </span>
      </Tooltip>
    </div>
  );
}
