import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertCircle, ArrowLeft, CheckCircle2, FileArchive, FolderOpen, GitBranch, HardDrive, MinusCircle, Package, X, XCircle } from "lucide-react";
import { api, errorMessage, pickSource } from "../lib/api";
import type { OpReport, ResolvedSource } from "../lib/types";
import { cx, plural, visibleAgents } from "../lib/ui";
import { useActions, useData, useNav } from "../state/store";
import { AgentAvatar, GitHubMark } from "../components/identity";
import { Button, Checkbox, Kbd, Spinner, Switch, TextField } from "../components/ui";
import { Sheet } from "../components/overlay";

type Step = "source" | "pick" | "done";

export function InstallSheet() {
  const { install, closeInstall } = useNav();
  return (
    <Sheet open={install.open} onClose={closeInstall} width={620} label="Install skills">
      {install.open && <InstallFlow key={`${install.input}|${install.only?.join(",")}`} />}
    </Sheet>
  );
}

function InstallFlow() {
  const { install, closeInstall, go } = useNav();
  const { inventory, settings } = useData();
  const { rescan } = useActions();
  const [step, setStep] = useState<Step>("source");
  const [input, setInput] = useState(install.input);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<ResolvedSource | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [customizeAgents, setCustomizeAgents] = useState(false);
  const [agentIds, setAgentIds] = useState<Set<string>>(new Set());
  const [overwrite, setOverwrite] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [report, setReport] = useState<OpReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const agents = useMemo(() => (inventory ? visibleAgents(inventory.agents) : []), [inventory]);

  const resolve = async (value = input) => {
    const v = value.trim();
    if (!v) return;
    setResolving(true);
    setError(null);
    try {
      const r = await api.resolveSource(v);
      setResolved(r);
      const valid = r.candidates.filter((c) => !c.issues.some((i) => i.severity === "error"));
      const pre = install.only
        ? valid.filter((c) => install.only!.includes(c.id))
        : valid.filter((c) => !c.alreadyInstalled);
      setPicked(new Set(pre.map((c) => c.path)));
      const defaults = settings?.defaultAgents.length ? settings.defaultAgents : agents.map((a) => a.id);
      setAgentIds(new Set(defaults.filter((id) => agents.some((a) => a.id === id))));
      setOverwrite(false);
      setStep("pick");
    } catch (e) {
      setError(errorMessage(e));
      requestAnimationFrame(() => inputRef.current?.focus());
    } finally {
      setResolving(false);
    }
  };

  useEffect(() => {
    if (install.autoResolve && install.input) void resolve(install.input);
  }, []);

  const doInstall = async () => {
    if (!resolved) return;
    setInstalling(true);
    try {
      const universal = settings?.universal && !customizeAgents;
      const r = await api.install({ token: resolved.token, paths: [...picked], agents: universal ? agents.map((a) => a.id) : [...agentIds], overwrite });
      setReport(r);
      setStep("done");
      await rescan({ quiet: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  const choose = async (kind: "folder" | "zip") => {
    try {
      const p = await pickSource(kind);
      if (p) {
        setInput(p);
        void resolve(p);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const selected = resolved?.candidates.filter((c) => picked.has(c.path)) ?? [];
  const selectedInstalled = selected.filter((c) => c.alreadyInstalled).length;
  const selectable = resolved?.candidates.filter((c) => !c.issues.some((i) => i.severity === "error")) ?? [];

  return (
    <>
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        {step === "pick" && (
          <button
            type="button"
            onClick={() => setStep("source")}
            className="-ml-1 flex h-6 w-6 items-center justify-center rounded-md text-fg-2 hover:bg-hover hover:text-fg"
            aria-label="Back"
          >
            <ArrowLeft size={15} />
          </button>
        )}
        <div className="flex-1 text-[14px] font-semibold">
          {step === "source" ? "Install skills" : step === "pick" ? "Choose skills" : "Done"}
        </div>
        <button
          type="button"
          onClick={closeInstall}
          className="flex h-6 w-6 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      {step === "source" && (
        <div className="p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void resolve();
            }}
            className="flex gap-2"
          >
            <TextField
              ref={inputRef}
              data-autofocus
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                setError(null);
              }}
              placeholder="owner/repo, a GitHub or git URL, or a local path"
              mono
              className={cx("h-8 flex-1 text-[12.5px]", error && "border-red")}
              aria-label="Source"
              aria-invalid={!!error}
            />
            <Button type="submit" variant="primary" className="h-8" loading={resolving} disabled={!input.trim()}>
              Continue
            </Button>
          </form>
          {error ? (
            <div className="anim-fade mt-2 flex items-start gap-1.5 text-[12px] text-red">
              <AlertCircle size={13} className="mt-px shrink-0" /> {error}
            </div>
          ) : (
            <div className="mt-2 text-[11.5px] text-fg-3">
              e.g. <Example onPick={setInput}>anthropics/skills</Example>, <Example onPick={setInput}>https://github.com/obra/superpowers</Example>,{" "}
              <Example onPick={setInput}>git@github.com:mattpocock/skills.git</Example>
            </div>
          )}

          <div className="my-5 flex items-center gap-3 text-[11px] text-fg-3">
            <div className="h-px flex-1 bg-line" /> or from this Mac <div className="h-px flex-1 bg-line" />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <SourceTile icon={<FolderOpen size={16} />} title="Choose folder…" hint="A skill, or a folder of skills" onClick={() => void choose("folder")} />
            <SourceTile icon={<FileArchive size={16} />} title="Choose .zip…" hint="A zipped skill or collection" onClick={() => void choose("zip")} />
          </div>
          <div className="mt-4 text-center text-[11.5px] text-fg-3">You can also drop a folder or .zip anywhere on the window.</div>
        </div>
      )}

      {step === "pick" && resolved && (
        <>
          <div className="scroll min-h-0 flex-1">
            <div className="flex items-center gap-2 border-b border-line bg-surface-2 px-4 py-2.5">
              <SourceIcon kind={resolved.kind} />
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{resolved.display}</span>
              <span className="text-[11.5px] text-fg-3">{plural(resolved.candidates.length, "skill")} found</span>
            </div>

            <div className="flex h-9 items-center gap-2.5 border-b border-line px-4">
              <Checkbox
                checked={picked.size > 0 && picked.size === selectable.length}
                indeterminate={picked.size > 0 && picked.size < selectable.length}
                onChange={(v) => setPicked(v ? new Set(selectable.map((c) => c.path)) : new Set())}
                label="Select all"
              />
              <span className="text-[12px] font-medium text-fg-2">Select all</span>
              <span className="ml-auto text-[11.5px] text-fg-3 tabular-nums">{picked.size} selected</span>
            </div>
            {resolved.candidates.map((c) => {
              const invalid = c.issues.find((i) => i.severity === "error");
              const on = picked.has(c.path);
              return (
                <label
                  key={c.path}
                  className={cx("flex items-start gap-2.5 border-b border-line px-4 py-2.5", invalid ? "opacity-60" : "hover:bg-hover")}
                  onClick={(e) => {
                    e.preventDefault();
                    if (invalid) return;
                    setPicked((p) => {
                      const n = new Set(p);
                      if (n.has(c.path)) n.delete(c.path);
                      else n.add(c.path);
                      return n;
                    });
                  }}
                >
                  <span className="pt-0.5">
                    <Checkbox checked={on} disabled={!!invalid} label={c.name} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{c.name}</span>
                      {c.alreadyInstalled && <span className="text-[11px] text-fg-3">Installed</span>}
                      {invalid && <span className="text-[11px] text-red">Invalid</span>}
                    </div>
                    <div className={cx("mt-0.5 line-clamp-2 text-[12px] leading-snug", invalid ? "text-red" : "text-fg-2")}>
                      {invalid ? invalid.message : c.description || "No description"}
                    </div>
                  </div>
                </label>
              );
            })}

            {settings?.universal && !customizeAgents ? (
              <div className="mx-4 mt-4 mb-2 flex items-center gap-3 rounded-[8px] bg-surface-2 px-3 py-2.5 dark:bg-[rgba(255,255,255,0.04)]">
                <div className="flex -space-x-1">
                  {agents.slice(0, 6).map((a) => (
                    <span key={a.id} className="rounded-[6px] ring-2 ring-[var(--q-elevated)]">
                      <AgentAvatar id={a.id} name={a.name} size={18} />
                    </span>
                  ))}
                </div>
                <div className="min-w-0 flex-1 text-[12px] leading-snug">
                  <div className="font-medium">Goes to all {plural(agents.length, "agent")}</div>
                  <div className="text-fg-2">New agents you install later get it too.</div>
                </div>
                <button
                  type="button"
                  className="shrink-0 rounded px-1 text-[12px] text-accent-text hover:underline"
                  onClick={() => setCustomizeAgents(true)}
                >
                  Choose Agents…
                </button>
              </div>
            ) : (
            <div className="px-4 pt-4 pb-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[12px] font-semibold text-fg-2">Link to</span>
                <button
                  type="button"
                  className="rounded px-1 text-[12px] text-accent-text hover:underline"
                  onClick={() => setAgentIds(agentIds.size === agents.length ? new Set() : new Set(agents.map((a) => a.id)))}
                >
                  {agentIds.size === agents.length ? "Select None" : "Select All"}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
                {agents.map((a) => {
                  const on = agentIds.has(a.id) || a.readsCanonical;
                  const toggle = () =>
                    setAgentIds((s) => {
                      const n = new Set(s);
                      if (n.has(a.id)) n.delete(a.id);
                      else n.add(a.id);
                      return n;
                    });
                  return (
                    <div
                      key={a.id}
                      title={a.readsCanonical ? `${a.name} reads ~/.agents/skills directly` : undefined}
                      onClick={() => !a.readsCanonical && toggle()}
                      className={cx("flex h-[24px] min-w-0 items-center gap-1.5 text-[12.5px]", a.readsCanonical && "opacity-60")}
                    >
                      <Checkbox checked={on} disabled={a.readsCanonical} onChange={toggle} label={a.name} />
                      <AgentAvatar id={a.id} name={a.name} size={16} />
                      <span className="truncate">{a.name}</span>
                    </div>
                  );
                })}
              </div>
            </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t border-line px-4 py-3">
            <label className={cx("flex items-center gap-2 text-[12px]", !selectedInstalled && "opacity-50")}>
              <Switch size="sm" checked={overwrite} disabled={!selectedInstalled} onChange={setOverwrite} label="Overwrite existing" />
              Overwrite {selectedInstalled ? plural(selectedInstalled, "installed skill") : "existing"}
            </label>
            {error && (
              <span className="min-w-0 truncate text-[12px] text-red" title={error}>
                {error}
              </span>
            )}
            <div className="flex-1" />
            <Button onClick={closeInstall}>Cancel</Button>
            <Button variant="primary" disabled={!picked.size} loading={installing} onClick={() => void doInstall()}>
              Install {picked.size ? plural(picked.size, "skill") : ""}
            </Button>
          </div>
        </>
      )}

      {step === "done" && report && (
        <>
          <div className="scroll min-h-0 flex-1 p-5">
            <div className="flex items-center gap-3">
              <div
                className={cx(
                  "flex h-9 w-9 items-center justify-center rounded-full",
                  report.errors.length ? "bg-amber-soft text-amber" : "bg-green-soft text-green",
                )}
              >
                {report.errors.length ? <AlertCircle size={18} /> : <CheckCircle2 size={18} />}
              </div>
              <div>
                <div className="text-[14px] font-semibold">
                  {report.ok.length ? `Installed ${plural(report.ok.length, "skill")}` : "Nothing installed"}
                </div>
                <div className="text-[12px] text-fg-2">
                  {report.ok.length
                    ? settings?.universal && !customizeAgents
                      ? `Visible to all ${plural(agents.length, "agent")}.`
                      : `Visible to ${plural(agents.filter((a) => agentIds.has(a.id) || a.readsCanonical).length, "agent")}.`
                    : "See the details below."}
                </div>
              </div>
            </div>
            <div className="mt-4 overflow-hidden rounded-lg border border-line">
              {report.ok.map((id) => (
                <ResultRow key={id} icon={<CheckCircle2 size={13} className="text-green" />} id={id} />
              ))}
              {report.skipped.map((s) => (
                <ResultRow key={s.id} icon={<MinusCircle size={13} className="text-fg-3" />} id={s.id} message={s.message} />
              ))}
              {report.errors.map((s) => (
                <ResultRow key={s.id} icon={<XCircle size={13} className="text-red" />} id={s.id} message={s.message} />
              ))}
            </div>
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-line px-4 py-3">
            <Button
              onClick={() => {
                setStep("source");
                setInput("");
                setResolved(null);
                setReport(null);
              }}
            >
              Install more
            </Button>
            {report.ok.length > 0 && (
              <Button
                onClick={() => {
                  closeInstall();
                  go("library", { selectedId: report.ok[0], filter: "all", agentFilter: null });
                }}
              >
                Show in Library
              </Button>
            )}
            <Button variant="primary" data-autofocus onClick={closeInstall}>
              Done
            </Button>
          </div>
        </>
      )}

      {step === "source" && resolving && install.autoResolve && (
        <div className="absolute inset-0 top-12 flex items-center justify-center gap-2 bg-elevated text-[12.5px] text-fg-2">
          <Spinner /> Looking for skills in {install.input}…
        </div>
      )}
      {step === "source" && (
        <div className="flex shrink-0 items-center justify-end gap-1.5 border-t border-line px-4 py-2 text-[11px] text-fg-3">
          <Kbd>↵</Kbd> continue <Kbd className="ml-2">esc</Kbd> close
        </div>
      )}
    </>
  );
}

function Example({ children, onPick }: { children: string; onPick: (v: string) => void }) {
  return (
    <button type="button" onClick={() => onPick(children)} className="font-mono text-fg-2 underline decoration-line-2 underline-offset-2 hover:text-fg">
      {children}
    </button>
  );
}

function SourceTile({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 rounded-[10px] border-[0.5px] border-line-2 p-3 text-left transition-colors duration-100 hover:border-line-2 hover:bg-hover"
    >
      <span className="flex h-8 w-8 items-center justify-center text-accent [&_svg]:h-[20px] [&_svg]:w-[20px] [&_svg]:stroke-[1.6]">{icon}</span>
      <span>
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block text-[11.5px] text-fg-3">{hint}</span>
      </span>
    </button>
  );
}

function SourceIcon({ kind }: { kind: ResolvedSource["kind"] }) {
  if (kind === "github") return <GitHubMark size={14} />;
  if (kind === "git") return <GitBranch size={14} className="text-fg-2" />;
  if (kind === "zip") return <Package size={14} className="text-fg-2" />;
  return <HardDrive size={14} className="text-fg-2" />;
}

function ResultRow({ icon, id, message }: { icon: ReactNode; id: string; message?: string }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-line px-3 py-2 last:border-b-0">
      {icon}
      <span className="text-[12.5px] font-medium">{id}</span>
      {message && <span className="min-w-0 flex-1 truncate text-right text-[12px] text-fg-3">{message}</span>}
    </div>
  );
}
