import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowRight, Check, Compass, Link2, Sparkles } from "lucide-react";
import { visibleAgents, plural } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { AgentAvatar, Logo } from "../components/identity";
import { Button } from "../components/ui";
import { Sheet } from "../components/overlay";
import { applySync, usePlan } from "./Health";

const KEY = "quiver.onboarded.v1";

export function Onboarding() {
  const { inventory } = useData();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!inventory) return;
    const param = new URLSearchParams(location.search).get("onboarding");
    if (param === "0") return; // screenshots / embeds that want the plain UI
    if (param !== null || !localStorage.getItem(KEY)) setOpen(true);
    // Only decide once, on the first inventory.
  }, [inventory === null]);

  const close = () => {
    localStorage.setItem(KEY, String(Date.now()));
    setOpen(false);
  };

  return (
    <Sheet open={open} onClose={close} width={500} label="Welcome to Quiver">
      {open && <Welcome onClose={close} />}
    </Sheet>
  );
}

function Welcome({ onClose }: { onClose: () => void }) {
  const { inventory, settings } = useData();
  const { rescan, saveSettings } = useActions();
  const { go, openInstall } = useNav();
  const { plan } = usePlan();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const agents = useMemo(() => (inventory ? visibleAgents(inventory.agents) : []), [inventory]);
  const skills = inventory?.skills.filter((s) => !s.plugin) ?? [];
  const single = skills.filter((s) => {
    const n = s.presence.filter((p) => agents.some((a) => a.id === p.agentId) && p.presence !== "absent" && p.presence !== "broken").length;
    return n === 1;
  }).length;
  const work = plan ? plan.adopt.length + plan.links.length + plan.prune.length : 0;

  const enableUniversal = async () => {
    if (settings && !settings.universal) await saveSettings({ ...settings, universal: true });
  };

  const makeUniversal = async () => {
    setBusy(true);
    const r = await applySync({ adopt: true, link: true, prune: true }, rescan);
    if (r) await enableUniversal();
    setBusy(false);
    if (r) setDone(true);
  };

  const empty = skills.length === 0;
  // Nothing to rearrange yet, so universal mode can simply be on.
  useEffect(() => {
    if (empty) void enableUniversal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empty]);

  return (
    <div className="relative overflow-hidden">
      <div className="relative px-7 pt-8 pb-6 text-center">
        <div className="flex justify-center">
          <Logo size={72} />
        </div>
        <h2 className="mt-4 text-[19px] font-semibold tracking-[-0.02em]">{done ? "Every skill is universal" : "Welcome to Quiver"}</h2>

        {done ? (
          <p className="mx-auto mt-2 max-w-[360px] text-[13px] leading-relaxed text-fg-2">
            Your skills now live in <span className="font-mono text-[12px]">~/.agents/skills</span> and every agent links to the same copy.
            Universal mode is on: new installs, and skills you add to any one agent, are shared with all of them automatically.
          </p>
        ) : empty ? (
          <p className="mx-auto mt-2 max-w-[370px] text-[13px] leading-relaxed text-fg-2">
            Found {plural(agents.length, "coding agent")} and no skills yet. Install a skill once and Quiver links it into every agent.
          </p>
        ) : (
          <p className="mx-auto mt-2 max-w-[380px] text-[13px] leading-relaxed text-fg-2">
            Found <b className="font-semibold text-fg">{plural(skills.length, "skill")}</b> across{" "}
            <b className="font-semibold text-fg">{plural(agents.length, "agent")}</b>.{" "}
            {single > 0 ? (
              <>
                <b className="font-semibold text-fg">{single}</b> {single === 1 ? "is" : "are"} only visible to a single agent.
              </>
            ) : (
              "Most of them are already shared."
            )}
          </p>
        )}

        <div className="mt-5 flex flex-wrap justify-center gap-1.5">
          {agents.slice(0, 12).map((a) => (
            <span key={a.id} title={a.name}>
              <AgentAvatar id={a.id} name={a.name} size={24} />
            </span>
          ))}
        </div>

        {!done && !empty && plan && (
          <div className="mx-auto mt-5 grid max-w-[380px] grid-cols-3 gap-2 text-left">
            <Mini icon={<Sparkles size={12} />} n={plan.adopt.length} label="to adopt" />
            <Mini icon={<Link2 size={12} />} n={plan.links.length} label="links to add" />
            <Mini icon={<Check size={12} />} n={plan.prune.length} label="broken to fix" />
          </div>
        )}
        {!done && !empty && plan && plan.conflicts.length > 0 && (
          <p className="mt-3 text-[11.5px] text-fg-3">
            {plural(plan.conflicts.length, "conflict")} need{plan.conflicts.length === 1 ? "s" : ""} your decision; you'll find {plan.conflicts.length === 1 ? "it" : "them"} in Health.
          </p>
        )}
      </div>

      <div className="relative flex flex-col gap-2 border-t border-line px-7 py-4">
        {done ? (
          <Button variant="primary" size="lg" data-autofocus onClick={onClose}>
            Get started <ArrowRight size={14} />
          </Button>
        ) : empty ? (
          <>
            <Button
              variant="primary"
              size="lg"
              data-autofocus
              icon={<Compass size={14} />}
              onClick={() => {
                onClose();
                go("discover");
              }}
            >
              Browse skills
            </Button>
            <Button
              variant="ghost"
              size="lg"
              onClick={() => {
                onClose();
                openInstall();
              }}
            >
              Install from GitHub or a folder
            </Button>
          </>
        ) : (
          <>
            <Button variant="primary" size="lg" data-autofocus icon={<Sparkles size={14} />} loading={busy} disabled={!plan || work === 0} onClick={() => void makeUniversal()}>
              {plan && work === 0 ? "Already universal" : "Make everything universal"}
            </Button>
            <Button variant="ghost" size="lg" onClick={onClose}>
              Skip for now
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function Mini({ icon, n, label }: { icon: ReactNode; n: number; label: string }) {
  return (
    <div className="rounded-[8px] bg-surface-2 px-2.5 py-2 dark:bg-[rgba(255,255,255,0.04)]">
      <div className="flex items-center gap-1.5 text-[16px] font-semibold tabular-nums">
        <span className="text-fg-3">{icon}</span>
        {n}
      </div>
      <div className="text-[11px] text-fg-3">{label}</div>
    </div>
  );
}
