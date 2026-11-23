import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Check, ChevronRight, ChevronsUpDown, Loader2, Search, X } from "lucide-react";
import { cx } from "../lib/ui";

// ── Button ───────────────────────────────────────────────────────────────────
// Proportions follow AppKit's regular/small push buttons: 13pt regular label,
// ~22pt tall, 6pt corner radius. The default button is filled with the accent.

type Variant = "primary" | "secondary" | "ghost" | "danger" | "dangerGhost" | "toolbar";
type Size = "sm" | "md" | "lg";

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg shadow-[inset_0_0.5px_0_rgba(255,255,255,0.28),0_0.5px_1px_rgba(0,0,0,0.25)] bg-[image:linear-gradient(to_bottom,rgba(255,255,255,0.1),rgba(255,255,255,0))] active:brightness-[0.92] disabled:opacity-45",
  secondary:
    "bg-[var(--q-control)] text-fg border-[0.5px] border-[var(--q-control-border)] shadow-[var(--q-control-shadow)] active:brightness-[0.95] dark:active:brightness-125 disabled:opacity-45",
  ghost: "text-fg-2 hover:text-fg hover:bg-hover active:bg-press disabled:opacity-40",
  toolbar: "text-fg-2 hover:bg-hover hover:text-fg active:bg-press disabled:opacity-35",
  danger: "bg-red text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.25),0_0.5px_1px_rgba(0,0,0,0.25)] active:brightness-95 disabled:opacity-45",
  dangerGhost: "text-red hover:bg-red-soft disabled:opacity-40",
};

const sizes: Record<Size, string> = {
  sm: "h-[20px] px-2 text-[12px] rounded-[5px] gap-1",
  md: "h-[24px] px-2.5 text-[13px] rounded-[6px] gap-1.5",
  lg: "h-[28px] px-3 text-[13px] rounded-[7px] gap-1.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      className={cx(
        "inline-flex shrink-0 items-center justify-center font-normal whitespace-nowrap transition-[background-color,color,opacity,filter] duration-75 select-none",
        sizes[size],
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 size={12} className="spin" /> : icon}
      {children}
    </button>
  );
});

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }>(
  function IconButton({ label, active, className, children, ...rest }, ref) {
    return (
      <Tooltip content={label}>
        <button
          ref={ref}
          type="button"
          aria-label={label}
          className={cx(
            "inline-flex h-[26px] min-w-[28px] items-center justify-center rounded-[6px] px-1 text-fg-2 transition-colors duration-75 hover:bg-hover hover:text-fg active:bg-press disabled:opacity-35",
            active && "bg-press text-fg",
            className,
          )}
          {...rest}
        >
          {children}
        </button>
      </Tooltip>
    );
  },
);

// ── Switch / Checkbox ────────────────────────────────────────────────────────

export function Switch({
  checked,
  onChange,
  disabled,
  label,
  size = "md",
  tone = "accent",
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
  size?: "sm" | "md";
  tone?: "accent" | "muted";
}) {
  // AppKit's small (32×18) and mini (26×15) NSSwitch.
  const w = size === "sm" ? 26 : 32;
  const h = size === "sm" ? 15 : 18;
  const k = h - 2;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
      className={cx(
        "relative shrink-0 rounded-full transition-colors duration-200 ease-out",
        checked ? (tone === "muted" ? "bg-fg-3" : "bg-accent") : "bg-[var(--q-track)]",
        disabled && "opacity-45",
      )}
      style={{ width: w, height: h, boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.08)" }}
    >
      <span
        className="absolute top-[1px] left-[1px] rounded-full bg-white shadow-[0_0.5px_1.5px_rgba(0,0,0,0.3),0_0_0_0.5px_rgba(0,0,0,0.04)] transition-transform duration-200 ease-out"
        style={{ width: k, height: k, transform: `translateX(${checked ? w - k - 2 : 0}px)` }}
      />
    </button>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange?: (v: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  const on = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange?.(!checked);
      }}
      className={cx(
        "inline-flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[3.5px] transition-colors duration-75",
        on
          ? "bg-accent text-white shadow-[inset_0_0.5px_0_rgba(255,255,255,0.25)]"
          : "border-[0.5px] border-[rgba(0,0,0,0.3)] bg-white shadow-[0_0.5px_1px_rgba(0,0,0,0.1)] dark:border-[rgba(255,255,255,0.22)] dark:bg-[rgba(255,255,255,0.08)]",
        disabled && "opacity-40",
      )}
    >
      {indeterminate ? <span className="h-[1.5px] w-2 rounded bg-white" /> : checked ? <Check size={10} strokeWidth={3.2} /> : null}
    </button>
  );
}

// ── Inputs ───────────────────────────────────────────────────────────────────

export const SearchField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> & { value: string; onChange: (v: string) => void; width?: number; large?: boolean }
>(function SearchField({ value, onChange, className, width, large, ...rest }, ref) {
  return (
    <div
      className={cx(
        "group relative flex items-center bg-[var(--q-hover)] transition-shadow focus-within:shadow-[0_0_0_3px_var(--q-ring)] dark:bg-[rgba(255,255,255,0.07)]",
        large ? "h-[30px] rounded-[8px]" : "h-[26px] rounded-[6px]",
        className,
      )}
      style={width ? { width } : undefined}
    >
      <Search size={large ? 14 : 12.5} strokeWidth={2.2} className={cx("pointer-events-none absolute text-fg-3", large ? "left-[9px]" : "left-[7px]")} />
      <input
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        spellCheck={false}
        autoCorrect="off"
        className={cx("h-full w-full min-w-0 bg-transparent pr-6 placeholder:text-fg-3 focus-visible:outline-none", large ? "pl-[29px] text-[13.5px]" : "pl-[25px] text-[13px]")}
        {...rest}
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute right-[5px] flex h-[14px] w-[14px] items-center justify-center rounded-full bg-fg-3 text-surface hover:bg-fg-2"
        >
          <X size={9} strokeWidth={3.2} />
        </button>
      )}
    </div>
  );
});

const fieldBase =
  "rounded-[5px] border-[0.5px] border-[var(--q-line-2)] bg-[var(--q-field)] text-[13px] placeholder:text-fg-3 shadow-[inset_0_0.5px_1px_rgba(0,0,0,0.06)] transition-shadow focus-visible:outline-none focus:shadow-[0_0_0_3px_var(--q-ring)]";

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { mono?: boolean }>(
  function TextField({ className, mono, ...rest }, ref) {
    return (
      <input
        ref={ref}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        className={cx("h-[24px] px-2", fieldBase, mono && "font-mono text-[12px]", className)}
        {...rest}
      />
    );
  },
);

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function TextArea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cx("resize-none px-2 py-1.5 leading-snug", fieldBase, className)} {...rest} />;
});

/** AppKit-style pop-up button wrapping a native <select>. */
export function Select<T extends string | number>({
  value,
  onChange,
  options,
  disabled,
  className,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
  className?: string;
  label?: string;
}) {
  return (
    <span className={cx("relative inline-flex", disabled && "opacity-45", className)}>
      <select
        aria-label={label}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value);
          if (o) onChange(o.value);
        }}
        className="h-[22px] w-full appearance-none rounded-[6px] border-[0.5px] border-[var(--q-control-border)] bg-[var(--q-control)] pr-6 pl-2 text-[13px] shadow-[var(--q-control-shadow)] focus-visible:outline-none focus:shadow-[0_0_0_3px_var(--q-ring)]"
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="pointer-events-none absolute top-[3px] right-[3px] flex h-[16px] w-[16px] items-center justify-center rounded-[4px] bg-accent text-white">
        <ChevronsUpDown size={10} strokeWidth={2.6} />
      </span>
    </span>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; count?: number; title?: string }[];
  size?: "sm" | "md";
  label?: string;
}) {
  return (
    <div
      className="inline-flex shrink-0 rounded-[7px] bg-[var(--q-track)] p-[1.5px] dark:bg-[rgba(255,255,255,0.08)]"
      role="tablist"
      aria-label={label}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            title={o.title}
            aria-selected={active}
            onClick={() => onChange(o.value)}
            className={cx(
              "inline-flex items-center justify-center gap-1.5 rounded-[5.5px] whitespace-nowrap transition-[background-color,color,box-shadow] duration-100",
              size === "sm" ? "h-[19px] px-2 text-[11.5px]" : "h-[21px] px-2.5 text-[12.5px]",
              active
                ? "bg-[var(--q-control)] text-fg shadow-[0_0.5px_1.5px_rgba(0,0,0,0.16),0_0_0_0.5px_rgba(0,0,0,0.05)] dark:bg-[#636366] dark:shadow-[0_0.5px_1px_rgba(0,0,0,0.4)]"
                : "text-fg hover:bg-[rgba(0,0,0,0.035)] dark:hover:bg-[rgba(255,255,255,0.04)]",
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="text-fg-2 tabular-nums">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ── Display ──────────────────────────────────────────────────────────────────

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx("inline-flex items-center font-sans text-[11.5px] tracking-[0.04em] text-fg-3", className)}>{children}</kbd>;
}

export function Chip({
  children,
  tone = "neutral",
  className,
  title,
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "green" | "amber" | "red" | "blue";
  className?: string;
  title?: string;
}) {
  // Quiet label: tinted text with a hairline outline, no fills.
  const tones = {
    neutral: "text-fg-2",
    accent: "text-accent-text",
    green: "text-green",
    amber: "text-amber",
    red: "text-red",
    blue: "text-accent-text",
  };
  return (
    <span
      title={title}
      className={cx(
        "inline-flex h-[17px] max-w-full shrink-0 items-center gap-1 truncate rounded-[4px] border-[0.5px] border-current/30 px-1.5 text-[10.5px] font-medium whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Sidebar-style count capsule (like Mail's unread count). */
export function Badge({ count, tone = "neutral" }: { count: number; tone?: "neutral" | "accent" | "red" | "amber" }) {
  if (!count) return null;
  return (
    <span
      className={cx(
        "inline-flex h-[16px] min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-medium tabular-nums",
        tone === "red" ? "bg-red text-white" : "bg-[rgba(0,0,0,0.08)] text-fg-2 dark:bg-[rgba(255,255,255,0.1)]",
      )}
    >
      {count > 999 ? "999+" : count}
    </span>
  );
}

/** Tiny capacity bar used for agent coverage. */
export function Meter({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span aria-hidden className={cx("meter-track relative inline-block h-[4px] w-[28px] shrink-0 overflow-hidden rounded-full bg-[var(--q-track)]", className)}>
      <span className="meter-fill absolute inset-y-0 left-0 rounded-full bg-fg-3 transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </span>
  );
}

export function Spinner({ size = 14, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx("spin text-fg-3", className)} />;
}

export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div className={cx("skeleton", className)} style={style} />;
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
  wide,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Room for a sentence or two instead of a short line. */
  wide?: boolean;
}) {
  return (
    <div className={cx("flex flex-col items-center justify-center px-8 py-14 text-center", className)}>
      {icon && <div className="mb-3 text-fg-3 [&_svg]:h-[30px] [&_svg]:w-[30px] [&_svg]:stroke-[1.4]">{icon}</div>}
      <div className="text-[15px] font-semibold text-fg-2">{title}</div>
      {children && <div className={cx("mt-1 text-[12px] leading-[1.45] text-fg-3", wide ? "max-w-[400px]" : "max-w-[320px]")}>{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function SectionLabel({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex min-h-[22px] items-center justify-between gap-2 pb-1", className)}>
      <div className="text-[12px] font-semibold text-fg-2">{children}</div>
      {right}
    </div>
  );
}

/** Collapsible inspector section (Finder Get Info / Xcode inspector). Open state persists per key. */
export function Disclosure({
  id,
  title,
  right,
  children,
  defaultOpen = true,
  className,
}: {
  id: string;
  title: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const key = `quiver.disclosure.${id}`;
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(key);
    return v === null ? defaultOpen : v === "1";
  });
  return (
    <section className={cx("border-t border-line py-2.5", className)}>
      <div className="flex min-h-[22px] items-center gap-1">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            localStorage.setItem(key, open ? "0" : "1");
          }}
          className="-ml-1 flex flex-1 items-center gap-1 rounded px-1 text-left text-[12px] font-semibold text-fg-2 hover:text-fg"
        >
          <ChevronRight size={11} strokeWidth={2.6} className={cx("shrink-0 text-fg-3 transition-transform duration-150", open && "rotate-90")} />
          {title}
        </button>
        {right}
      </div>
      {open && <div className="pt-2">{children}</div>}
    </section>
  );
}

/** Key/value list (Get Info style): right-aligned secondary keys, selectable values. */
export function InfoList({ rows }: { rows: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[minmax(84px,auto)_1fr] gap-x-3 gap-y-[5px] text-[12px] leading-[1.4]">
      {rows.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-right text-fg-2">{k}</dt>
          <dd className="selectable min-w-0 break-words text-fg">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

// ── Toolbar (top bar of every pane; draggable window region) ────────────────

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      data-tauri-drag-region
      className={cx("flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line px-3.5", className)}
    >
      {children}
    </div>
  );
}

/** Unified-toolbar title with an optional subtitle underneath (macOS 11+). */
export function ToolbarTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <div data-tauri-drag-region className="flex min-w-0 flex-col justify-center pl-1 leading-none">
      <h1 data-tauri-drag-region className="truncate text-[15px] leading-[18px] font-semibold tracking-[-0.012em]">
        {children}
      </h1>
      {sub && (
        <span data-tauri-drag-region className="truncate text-[11px] leading-[14px] text-fg-2 tabular-nums">
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Tooltip ──────────────────────────────────────────────────────────────────

let lastTooltipClose = 0;

export function Tooltip({
  content,
  children,
  side = "bottom",
  delay = 450,
}: {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "bottom" | "right" | "left";
  delay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  if (!content) return <>{children}</>;
  const show = () => {
    const el = ref.current?.firstElementChild ?? ref.current;
    if (!el) return;
    // Skip the delay when moving between adjacent tooltips.
    const d = Date.now() - lastTooltipClose < 300 ? 0 : delay;
    timer.current = setTimeout(() => setRect(el.getBoundingClientRect()), d);
  };
  const hide = () => {
    clearTimeout(timer.current);
    if (rect) lastTooltipClose = Date.now();
    setRect(null);
  };
  return (
    <span ref={ref} className="contents" onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide}>
      {children}
      {rect && <TooltipBubble rect={rect} side={side} content={content} />}
    </span>
  );
}

export function TooltipBubble({ rect, side, content }: { rect: DOMRect; side: "top" | "bottom" | "right" | "left"; content: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let x = 0;
    let y = 0;
    let s = side;
    if (s === "top" && rect.top - h - 6 < 4) s = "bottom";
    if (s === "bottom" && rect.bottom + h + 6 > window.innerHeight - 4) s = "top";
    if (s === "right" && rect.right + w + 8 > window.innerWidth - 4) s = "left";
    if (s === "top" || s === "bottom") {
      x = rect.left + rect.width / 2 - w / 2;
      y = s === "top" ? rect.top - h - 6 : rect.bottom + 6;
    } else {
      y = rect.top + rect.height / 2 - h / 2;
      x = s === "right" ? rect.right + 8 : rect.left - w - 8;
    }
    x = Math.max(6, Math.min(x, window.innerWidth - w - 6));
    y = Math.max(6, Math.min(y, window.innerHeight - h - 6));
    setPos({ x, y });
  }, [rect, side]);
  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-[100] max-w-[280px] rounded-[5px] bg-elevated px-[7px] py-[3px] text-[11px] leading-snug text-fg shadow-pop"
      style={{ left: pos?.x ?? -9999, top: pos?.y ?? -9999, opacity: pos ? 1 : 0 }}
    >
      {content}
    </div>,
    document.body,
  );
}
