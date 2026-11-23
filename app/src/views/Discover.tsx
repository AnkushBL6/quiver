import { useEffect, useRef, useState } from "react";
import { Check, Compass, Download, ExternalLink, SearchX, WifiOff } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import type { SearchResult } from "../lib/types";
import { cx, formatCount } from "../lib/ui";
import { useDebounced, useSearchShortcut } from "../lib/hooks";
import { useData, useNav } from "../state/store";
import { GitHubMark } from "../components/identity";
import { Button, EmptyState, SearchField, Skeleton, Spinner, Toolbar, ToolbarTitle } from "../components/ui";

const POPULAR: { source: string; blurb: string; count: string }[] = [
  { source: "anthropics/skills", blurb: "Documents, design, MCP servers and skill authoring", count: "16 skills" },
  { source: "obra/superpowers", blurb: "Brainstorming, planning, TDD and systematic debugging", count: "10 skills" },
  { source: "vercel-labs/agent-skills", blurb: "React performance and web interface guidelines", count: "5 skills" },
  { source: "mattpocock/skills", blurb: "TDD, grilling sessions, architecture and prototypes", count: "6 skills" },
  { source: "expo/skills", blurb: "Native UI with Expo Router, deployment and upgrades", count: "3 skills" },
  { source: "wshobson/agents", blurb: "Python, RAG, CI/CD, Kubernetes and observability", count: "6 skills" },
];

const SUGGESTIONS = ["react", "pdf", "testing", "postgres", "design", "debugging"];

export function DiscoverView() {
  const { inventory } = useData();
  const { openInstall, nav } = useNav();
  // The Library hands over its search when nothing local matched.
  const [query, setQuery] = useState(nav.query);
  const q = useDebounced(query.trim(), 280);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  useSearchShortcut(searchRef);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!q) {
      setResults(null);
      setError(null);
      return;
    }
    let alive = true;
    setLoading(true);
    api
      .search(q)
      .then((r) => {
        if (!alive) return;
        setResults(r);
        setError(null);
      })
      .catch((e) => alive && setError(errorMessage(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [q]);

  // Installed state follows the live inventory, not the snapshot from the search call.
  const installedIds = new Set(inventory?.skills.map((s) => s.id));
  const isInstalled = (r: SearchResult) => r.installed || installedIds.has(r.name);

  return (
    <div className="flex h-full min-w-0 flex-col">
      <Toolbar>
        <ToolbarTitle sub="skills.sh directory">Discover</ToolbarTitle>
      </Toolbar>
      <div className="scroll min-h-0 flex-1 bg-surface">
        <div className="mx-auto max-w-[820px] px-5 pt-6 pb-8">
          <div className="relative">
            <SearchField
              ref={searchRef}
              value={query}
              onChange={setQuery}
              placeholder="Search thousands of skills: react, pdf, postgres…"
              className="h-9 [&_input]:text-[14px]"
              aria-label="Search skills.sh"
            />
            {loading && <Spinner size={13} className="absolute top-[11px] right-9" />}
          </div>

          {!q ? (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-[12px] text-fg-3">Try</span>
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setQuery(s)}
                    className="h-6 rounded-full border border-line px-2.5 text-[12px] text-fg-2 hover:border-line-2 hover:bg-hover hover:text-fg"
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="mt-8 mb-2 text-[12px] font-semibold text-fg-2">Popular Collections</div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
                {POPULAR.map((p) => (
                  <button
                    key={p.source}
                    type="button"
                    onClick={() => openInstall({ input: p.source, autoResolve: true })}
                    className="group flex flex-col rounded-[10px] border-[0.5px] border-line-2 p-3.5 text-left transition-[border-color,box-shadow] duration-150 hover:border-line-2 hover:shadow-[0_2px_10px_-4px_rgba(0,0,0,0.12)]"
                  >
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                      <GitHubMark size={13} />
                      <span className="truncate">{p.source}</span>
                    </div>
                    <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg-2">{p.blurb}</div>
                    <div className="mt-2.5 flex items-center justify-between text-[11.5px] text-fg-3">
                      {p.count}
                      <span className="font-medium text-accent-text opacity-0 transition-opacity duration-100 group-hover:opacity-100">Browse →</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : error ? (
            <EmptyState icon={<WifiOff size={20} />} title="Couldn't reach skills.sh">
              {error}
            </EmptyState>
          ) : !results ? (
            <div className="mt-4 flex flex-col gap-2">
              {Array.from({ length: 6 }, (_, i) => (
                <Skeleton key={i} className="h-[52px] rounded-lg" />
              ))}
            </div>
          ) : results.length === 0 ? (
            <EmptyState icon={<SearchX size={20} />} title={`No skills match “${q}”`}>
              Try a broader term, or paste a GitHub repo into the installer.
              <div className="mt-3">
                <Button onClick={() => openInstall({ input: q.includes("/") ? q : "" })}>Open installer</Button>
              </div>
            </EmptyState>
          ) : (
            <div className={cx("mt-4 overflow-hidden rounded-[10px] border-[0.5px] border-line-2 transition-opacity duration-150", loading && "opacity-60")}>
              {results.map((r, i) => {
                const installed = isInstalled(r);
                return (
                  <div key={r.id} className={cx("flex items-center gap-3 px-3.5 py-2.5", i > 0 && "border-t border-line")}>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-fg-3">
                      <Compass size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-medium">{r.name}</span>
                      </div>
                      <div className="flex items-center gap-1 truncate text-[11.5px] text-fg-3">
                        <GitHubMark size={10} />
                        {r.source}
                      </div>
                    </div>
                    <span className="flex shrink-0 items-center gap-1 text-[11.5px] text-fg-3 tabular-nums" title={`${r.installs.toLocaleString()} installs`}>
                      <Download size={11} />
                      {formatCount(r.installs)}
                    </span>
                    <a
                      href={`https://skills.sh/${r.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        void api.openPath(`https://skills.sh/${r.id}`).catch(() => window.open(`https://skills.sh/${r.id}`, "_blank"));
                      }}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-3 hover:bg-hover hover:text-fg"
                      aria-label="View on skills.sh"
                      title="View on skills.sh"
                    >
                      <ExternalLink size={13} />
                    </a>
                    {installed ? (
                      <span className="flex w-[74px] shrink-0 items-center justify-center gap-1 text-[12px] font-medium text-green">
                        <Check size={13} strokeWidth={2.5} /> Installed
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-[74px] shrink-0"
                        onClick={() => openInstall({ input: `${r.source}/${r.name}`, autoResolve: true, only: [r.name] })}
                      >
                        Install
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
