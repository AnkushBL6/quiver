import { AbsoluteFill, useCurrentFrame } from "remotion";
import { Cam, MatrixFill, Screen, Shot } from "../components/Screen";

/** 6 s seamless loop of the Matrix filling in, for the README GIF. Rendered at the app's own 1240×780. */
export const DEMO_LOOP_FRAMES = 180;

const CAM: Cam[] = [[0, 1, 620, 390]];

export function DemoLoop() {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "white" }}>
      <Screen frame={f} width={1240} layers={[{ src: "matrix-before", at: 0 }]} cam={CAM}>
        <MatrixFill frame={f} start={20} step={2.2} />
        {/* Fade back to the starting state so the loop is seamless. */}
        <Shot src="matrix-before" style={{ opacity: f < 140 ? 0 : Math.min(1, (f - 140) / 30) }} />
      </Screen>
    </AbsoluteFill>
  );
}
