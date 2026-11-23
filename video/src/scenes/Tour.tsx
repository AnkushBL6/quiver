import { ReactNode } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame } from "remotion";
import boxesJson from "../../public/capture/boxes.json";
import { Caption } from "../components/Caption";
import { Cam, FILL_SPAN, Layer, MatrixFill, Pt, ScrollPane, Screen, Toast, Typing, Window } from "../components/Screen";
import { appear, C, keys, sceneFade } from "../theme";

export type Beat = {
  caption: string;
  dur: number;
  layers: Layer[];
  cam: Cam[];
  cursor?: Pt[];
  clicks?: number[];
  cursorFade?: [number, number];
  extra?: (f: number) => ReactNode;
};

// Positions of the elements the cursor and camera aim at, measured by scripts/capture.mjs (app CSS px, 1240×780).
// `x`/`y` are element centres. Re-run `pnpm capture` after a UI change and everything below follows.
type Box = { x: number; y: number; w: number; h: number; textW?: number; lineH?: number; padL?: number; padT?: number };
const B = boxesJson as unknown as Record<string, Box & number & boolean>;
const box = (k: string): Box => {
  const b = B[k] as unknown as Box | undefined;
  if (!b) throw new Error(`missing box ${k}; run pnpm capture`);
  return b;
};
const num = (k: string) => B[k] as unknown as number;

const FILL_AT = 100;

// ── Library: scroll the grid under the fixed toolbar ───────────────────────────────────────────────────
const LIB_TALL_H = num("library.tallH");
const LIB_PANE = { x: 209, y: 94, w: 1031, h: 780 - 94 };
const libScroll = (f: number) =>
  keys(f, [
    [0, 0],
    [12, 0],
    [60, 760],
    [70, 760],
    [102, 0],
  ]);

// ── Skill sheet ────────────────────────────────────────────────────────────────────────────────────────
// The sheet is captured tall (all of its content) and scrolled in the video; the bar on top stays put.
const DLG = box("sheet.dialog"); // x, y are the top-left corner here
const BAR = 46;
const HEIGHT_A = num("sheet.heightA");
const HEIGHT_B = num("sheet.heightB");
const SCROLL_A = HEIGHT_A - DLG.h; // bottom of the collapsed sheet
const SCROLL_B = HEIGHT_B - DLG.h; // bottom once Agents is open
const AGENTS_HDR = box("sheet.agentsHeader");
const SWITCH = box("sheet.cursorSwitch");
const CLOSE = box("sheet.close");
const SKILL = "algorithmic-art";

const SHEET = { open: 34, scrollFrom: 58, scrollTo: 98, agents: 106, scrollB0: 110, scrollB1: 138, flip: 150, close: 176 };
const sheetScroll = (f: number) =>
  keys(f, [
    [0, 0],
    [SHEET.scrollFrom, 0],
    [SHEET.scrollTo, SCROLL_A],
    [SHEET.scrollB0, SCROLL_A],
    [SHEET.scrollB1, SCROLL_B],
  ]);
const hdrY = DLG.y + AGENTS_HDR.y - SCROLL_A;
const swX = DLG.x + SWITCH.x;
const swY = DLG.y + SWITCH.y - SCROLL_B;

function SheetScroll({ f }: { f: number }) {
  const s = sheetScroll(f);
  const gone = 1 - appear(f, SHEET.close, 10);
  if (f < SHEET.open + 12) return null;
  const title = appear(s, 60, 24); // the bar shows the skill's name once the header has scrolled away
  return (
    <div style={{ opacity: gone }}>
      <ScrollPane
        x={DLG.x}
        y={DLG.y + BAR}
        w={DLG.w}
        h={DLG.h - BAR}
        ix={0}
        iy={BAR}
        imgW={DLG.w}
        offset={s}
        radius="0 0 12px 12px"
        layers={[
          { src: "sheet-tall-a", imgH: HEIGHT_A },
          { src: "sheet-tall-b", imgH: HEIGHT_B, opacity: appear(f, SHEET.agents, 6) },
          { src: "sheet-tall-c", imgH: HEIGHT_B, opacity: appear(f, SHEET.flip, 6) },
        ]}
      />
      <div style={{ position: "absolute", left: DLG.x + 112, top: DLG.y + 9, width: DLG.w - 224, height: 28, background: "#fff", opacity: title, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 600, color: C.ink }}>
        {SKILL}
      </div>
      <div style={{ position: "absolute", left: DLG.x, top: DLG.y + BAR - 1, width: DLG.w, height: 1, background: "rgba(0,0,0,0.1)", opacity: title }} />
    </div>
  );
}

// ── Fields typed on screen: reveal the typed still left to right, with a caret ──────────────────────────
const MINE = { focus: 22, type: 28, per: 1.2, typed: 72, commit: 92 };
const INSTALL = { sidebar: 24, empty: 28, focus: 44, type: 48, per: 2, typed: 72, resolved: 80, selectAll: 98, go: 120, busy: 122, done: 130 };

const mineField = box("mine.field");
const installField = box("install.field");

const matrixToast = box("matrix.toast");
const TOAST_PAD = 10;

export const BEATS: Record<string, Beat> = {
  library: {
    caption: "See every skill on your Mac",
    dur: 110,
    layers: [{ src: "library", at: 0 }],
    cam: [[0, 1, 620, 390]],
    extra: (f) => <ScrollPane {...LIB_PANE} ix={209} iy={94} imgW={1240} offset={libScroll(f)} layers={[{ src: "library-tall", imgH: LIB_TALL_H }]} />,
  },

  sheet: {
    caption: "Choose which agents get each skill",
    dur: 190,
    layers: [
      { src: "library", at: 0 },
      { src: "library-card-hover", at: 24, fade: 4 },
      { src: "sheet-open", at: SHEET.open + 2, fade: 8 },
      { src: "library-shared", at: SHEET.close, fade: 10 },
    ],
    cam: [[0, 1, 620, 390], [SHEET.open, 1, 620, 390], [SHEET.open + 24, 1.1, 620, 390], [SHEET.close - 6, 1.1, 620, 390], [SHEET.close + 10, 1, 620, 390]],
    cursor: [
      [0, 800, 600],
      [24, box("library.card").x, box("library.card").y],
      [SHEET.open, box("library.card").x, box("library.card").y],
      [SHEET.open + 18, 700, 350],
      [SHEET.scrollTo, 700, 350],
      [SHEET.agents - 2, 300, hdrY],
      [SHEET.flip - 12, 300, hdrY],
      [SHEET.flip - 2, swX, swY],
      [SHEET.flip + 8, swX, swY],
      [SHEET.close - 9, DLG.x + CLOSE.x, DLG.y + CLOSE.y],
      [SHEET.close - 2, DLG.x + CLOSE.x, DLG.y + CLOSE.y],
      [SHEET.close + 10, 940, 430],
    ],
    clicks: [SHEET.open, SHEET.agents, SHEET.flip, SHEET.close - 3],
    extra: (f) => <SheetScroll f={f} />,
  },

  updates: {
    caption: "Update everything in one click",
    dur: 130,
    layers: [
      { src: "library", at: 0 },
      { src: "updates-busy", at: 34, fade: 3 },
      { src: "updates-confirm", at: 56, fade: 5 },
      { src: "updates-done", at: 90, fade: 10 },
    ],
    cam: [[0, 1, 620, 390], [20, 1.5, 640, 190], [100, 1.5, 640, 190], [122, 1, 620, 390]],
    cursor: [
      [0, 940, 430],
      [24, box("library.updateAll").x, box("library.updateAll").y],
      [32, box("library.updateAll").x, box("library.updateAll").y],
      [74, box("updates.confirm").x, box("updates.confirm").y],
      [82, box("updates.confirm").x, box("updates.confirm").y],
      [130, 900, 420],
    ],
    clicks: [30, 82],
  },

  mine: {
    caption: "Write your own and commit to git",
    dur: 126,
    layers: [
      { src: "mine", at: 0 },
      { src: "mine-focus", at: MINE.focus, fade: 3 },
      { src: "mine-typed", at: MINE.typed, fade: 4 },
      { src: "mine-done", at: MINE.commit + 2, fade: 8 },
    ],
    cam: [[0, 1, 620, 390], [18, 1.22, 770, 270], [MINE.commit + 4, 1.22, 770, 270], [MINE.commit + 18, 1, 620, 390]],
    cursor: [
      [0, 900, 420],
      [16, box("mine.message").x, box("mine.message").y],
      [MINE.focus + 6, box("mine.message").x, box("mine.message").y],
      [MINE.typed + 4, box("mine.message").x + 30, box("mine.message").y + 10],
      [MINE.commit - 6, box("mine.commit").x, box("mine.commit").y],
      [MINE.commit + 6, box("mine.commit").x, box("mine.commit").y],
      [126, 900, 500],
    ],
    clicks: [MINE.focus, MINE.commit],
    extra: (f) =>
      f < MINE.typed + 12 ? (
        <div style={{ opacity: 1 - appear(f, MINE.typed, 4) }}>
          <Typing
            frame={f}
            start={MINE.type}
            chars={num("mine.chars")}
            perChar={MINE.per}
            src="mine-typed"
            box={{ x: mineField.x, y: mineField.y - 2, h: (mineField.lineH ?? 18) + 4, textW: mineField.textW ?? 200, coverW: mineField.w - (mineField.padL ?? 9) - 6, caretH: 15 }}
          />
        </div>
      ) : null,
  },

  agents: {
    caption: "12 agents found. Symlink or copy, per agent",
    dur: 75,
    layers: [
      { src: "agents", at: 0 },
      { src: "agents-after", at: 30, fade: 6 },
    ],
    cam: [[0, 1, 620, 390], [20, 1.25, 820, 500], [75, 1.25, 820, 500]],
    cursor: [
      [0, 900, 500],
      [22, box("agents.windsurfSymlink").x, box("agents.windsurfSymlink").y],
      [34, box("agents.windsurfSymlink").x, box("agents.windsurfSymlink").y],
      [75, 1100, 560],
    ],
    clicks: [28],
  },

  matrix: {
    caption: "Make everything universal",
    dur: 190,
    layers: [
      { src: "matrix-before", at: 0 },
      { src: "onboarding", at: 20, fade: 12 },
      { src: "onboarding-hover", at: 48, fade: 6 },
      { src: "onboarding-busy", at: 63, fade: 4 },
      { src: "matrix-before", at: 86, fade: 12 },
    ],
    cam: [[0, 1, 620, 390], [20, 1, 620, 390], [54, 1.14, 620, 342], [88, 1.14, 620, 342], [FILL_AT - 4, 1, 620, 390]],
    cursor: [
      [0, 1100, 560],
      [46, box("onboarding.button").x, box("onboarding.button").y],
      [62, box("onboarding.button").x, box("onboarding.button").y],
      [98, 960, 640],
    ],
    clicks: [60],
    cursorFade: [0, 84],
    extra: (f) => (
      <>
        <MatrixFill frame={f} start={FILL_AT} />
        <Toast
          frame={f}
          at={FILL_AT + FILL_SPAN + 6}
          src="matrix-after-toast"
          box={{ x: matrixToast.x - matrixToast.w / 2 - TOAST_PAD, y: matrixToast.y - matrixToast.h / 2 - TOAST_PAD, w: matrixToast.w + TOAST_PAD * 2, h: matrixToast.h + TOAST_PAD * 2 }}
        />
      </>
    ),
  },

  health: {
    caption: "Fix conflicts and broken links",
    dur: 100,
    layers: [
      { src: "health", at: 0 },
      { src: "health-done", at: 56, fade: 8 },
    ],
    cam: [[0, 1, 620, 390], [16, 1.2, 725, 330], [70, 1.2, 725, 330], [88, 1, 620, 390]],
    cursor: [
      [0, 900, 560],
      [44, box("health.keep").x, box("health.keep").y],
      [56, box("health.keep").x, box("health.keep").y],
      [100, 900, 600],
    ],
    clicks: [54],
  },

  install: {
    caption: "Install from GitHub, git or a folder",
    dur: 150,
    layers: [
      { src: "library", at: 0 },
      { src: "install-empty", at: INSTALL.empty, fade: 6 },
      { src: "install-focus", at: INSTALL.focus, fade: 3 },
      { src: "install-typed", at: INSTALL.typed, fade: 4 },
      { src: "install-resolved", at: INSTALL.resolved, fade: 3 },
      { src: "install-selected", at: INSTALL.selectAll, fade: 3 },
      { src: "install-busy", at: INSTALL.busy, fade: 3 },
      { src: "install-done", at: INSTALL.done, fade: 4 },
    ],
    cam: [[0, 1, 620, 390], [32, 1, 620, 390], [52, 1.3, 690, 215], [76, 1.3, 690, 215], [92, 1.08, 640, 400]],
    cursor: [
      [0, 900, 600],
      [INSTALL.sidebar - 4, box("install.sidebar").x, box("install.sidebar").y],
      [INSTALL.sidebar + 2, box("install.sidebar").x, box("install.sidebar").y],
      [INSTALL.focus - 4, box("install.input").x, box("install.input").y],
      [INSTALL.focus + 4, box("install.input").x, box("install.input").y],
      [INSTALL.resolved + 14, box("install.selectAll").x, box("install.selectAll").y],
      [INSTALL.selectAll + 2, box("install.selectAll").x, box("install.selectAll").y],
      [INSTALL.go - 6, box("install.go").x, box("install.go").y],
      [INSTALL.go + 4, box("install.go").x, box("install.go").y],
      [150, 900, 560],
    ],
    clicks: [INSTALL.sidebar + 2, INSTALL.focus, INSTALL.selectAll - 1, INSTALL.go],
    extra: (f) =>
      f < INSTALL.typed + 12 ? (
        <div style={{ opacity: 1 - appear(f, INSTALL.typed, 4) }}>
          <Typing
            frame={f}
            start={INSTALL.type}
            chars={num("install.chars")}
            perChar={INSTALL.per}
            src="install-typed"
            box={{ x: installField.x, y: installField.y, h: installField.h - 2, textW: installField.textW ?? 90, coverW: installField.w - (installField.padL ?? 9) - 6, caretH: 15 }}
          />
        </div>
      ) : null,
  },
};

const WIN_W = 1360;

export function Tour({ beats, dur }: { beats: Beat[]; dur: number }) {
  const f = useCurrentFrame();
  const enter = appear(f, 0, 22);
  let start = 0;
  const seqs = beats.map((b, i) => {
    const s = start;
    start += b.dur;
    return { b, s, i };
  });
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, dur, 12, 9) }}>
      {/* Captions */}
      {seqs.map(({ b, s, i }) => (
        <Sequence key={`c${i}`} from={s} durationInFrames={b.dur} layout="none">
          <BeatCaption text={b.caption} dur={b.dur} first={i === 0} last={i === seqs.length - 1} />
        </Sequence>
      ))}
      {/* Window */}
      <div style={{ position: "absolute", left: (1920 - WIN_W) / 2, top: 184, opacity: enter, transform: `translateY(${(1 - enter) * 50}px) scale(${0.97 + enter * 0.03})` }}>
        <Window>
          <div style={{ position: "relative", width: WIN_W, height: (WIN_W * 780) / 1240 }}>
            {seqs.map(({ b, s, i }) => (
              <Sequence key={`s${i}`} from={s} durationInFrames={b.dur + (i < seqs.length - 1 ? 12 : 0)} layout="none">
                <BeatScreen beat={b} first={i === 0} />
              </Sequence>
            ))}
          </div>
        </Window>
      </div>
    </AbsoluteFill>
  );
}

function BeatCaption({ text, dur, first, last }: { text: string; dur: number; first: boolean; last: boolean }) {
  const f = useCurrentFrame();
  const out = last ? 0 : appear(f, dur - 10, 10);
  return (
    <div style={{ position: "absolute", left: 0, right: 0, top: 62, opacity: 1 - out }}>
      <Caption start={first ? 6 : 4} size={62}>
        {text}
      </Caption>
    </div>
  );
}

function BeatScreen({ beat, first }: { beat: Beat; first: boolean }) {
  const f = useCurrentFrame();
  return (
    <div style={{ position: "absolute", inset: 0, opacity: first ? 1 : appear(f, 0, 12) }}>
      <Screen frame={f} width={WIN_W} layers={beat.layers} cam={beat.cam} cursor={beat.cursor} clicks={beat.clicks} cursorFade={beat.cursorFade}>
        {beat.extra?.(f)}
      </Screen>
    </div>
  );
}
