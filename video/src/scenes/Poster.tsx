import { AbsoluteFill, Img, staticFile } from "remotion";
import { Background } from "../components/Background";
import { Accent } from "../components/Caption";
import { Screen, Window } from "../components/Screen";
import { C } from "../theme";

export function Poster() {
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18, marginTop: 70 }}>
          <Img src={staticFile("icon.png")} style={{ width: 84, height: 84 }} />
          <div style={{ fontSize: 54, fontWeight: 720, letterSpacing: "-0.04em", color: C.ink }}>Quiver</div>
        </div>
        <div style={{ marginTop: 22, fontSize: 76, fontWeight: 700, letterSpacing: "-0.04em", color: C.ink, textAlign: "center", lineHeight: 1.05 }}>
          One skill library for <Accent>every coding agent</Accent>.
        </div>
        <div style={{ position: "absolute", top: 352 }}>
          <Window>
            <Screen frame={0} width={1440} layers={[{ src: "library", at: 0 }]} />
          </Window>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
