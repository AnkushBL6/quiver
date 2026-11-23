import { ReactNode } from "react";
import { AbsoluteFill, Composition, Sequence, Still } from "remotion";
import { Background } from "./components/Background";
import { Cli } from "./scenes/Cli";
import { DEMO_LOOP_FRAMES, DemoLoop } from "./scenes/DemoLoop";
import { Hook } from "./scenes/Hook";
import { HowItWorks } from "./scenes/HowItWorks";
import { Outro } from "./scenes/Outro";
import { Poster } from "./scenes/Poster";
import { Problem } from "./scenes/Problem";
import { Reveal } from "./scenes/Reveal";
import { BEATS, Beat, Tour } from "./scenes/Tour";
import { FPS, FONT } from "./theme";

// Scenes dip through the background (fade out, then fade in) instead of cross-dissolving,
// so two headlines are never on screen at once.
const OVERLAP = 4;

type Scene = { dur: number; render: (dur: number) => ReactNode };
const tour = (beats: Beat[]): Scene => ({ dur: beats.reduce((a, b) => a + b.dur, 0), render: (d) => <Tour beats={beats} dur={d} /> });

const PRODUCT: Scene[] = [
  { dur: 90, render: (d) => <Hook dur={d} /> },
  { dur: 150, render: (d) => <Problem dur={d} /> },
  { dur: 100, render: (d) => <Reveal dur={d} /> },
  tour([BEATS.library, BEATS.sheet, BEATS.updates, BEATS.mine, BEATS.agents, BEATS.matrix, BEATS.health, BEATS.install]),
  { dur: 150, render: (d) => <HowItWorks dur={d} /> },
  { dur: 150, render: (d) => <Cli dur={d} /> },
  { dur: 130, render: (d) => <Outro dur={d} /> },
];

const TEASER: Scene[] = [
  { dur: 62, render: (d) => <Hook dur={d} stagger={2} /> },
  { dur: 80, render: (d) => <Reveal dur={d} /> },
  tour([{ ...BEATS.matrix, dur: 200 }]),
  { dur: 100, render: (d) => <Outro dur={d} /> },
];

const total = (s: Scene[]) => s.reduce((a, x) => a + x.dur, 0) - OVERLAP * (s.length - 1);

function Film({ scenes }: { scenes: Scene[] }) {
  let at = 0;
  return (
    <AbsoluteFill style={{ fontFamily: FONT, WebkitFontSmoothing: "antialiased" }}>
      <Background />
      {scenes.map((s, i) => {
        const from = at;
        at += s.dur - OVERLAP;
        return (
          <Sequence key={i} from={from} durationInFrames={s.dur}>
            {s.render(s.dur)}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}

export function Root() {
  return (
    <>
      <Composition id="Product" component={() => <Film scenes={PRODUCT} />} durationInFrames={total(PRODUCT)} fps={FPS} width={1920} height={1080} />
      <Composition id="Teaser" component={() => <Film scenes={TEASER} />} durationInFrames={total(TEASER)} fps={FPS} width={1920} height={1080} />
      <Still id="Poster" component={() => <div style={{ fontFamily: FONT, width: "100%", height: "100%" }}><Poster /></div>} width={1920} height={1080} />
      <Composition id="DemoLoop" component={DemoLoop} durationInFrames={DEMO_LOOP_FRAMES} fps={FPS} width={1240} height={780} />
    </>
  );
}
