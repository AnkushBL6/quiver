import { AbsoluteFill, Img, staticFile, useCurrentFrame } from "remotion";
import { Accent, Caption } from "../components/Caption";
import { appear, C, sceneFade } from "../theme";

export function Reveal({ dur }: { dur: number }) {
  const f = useCurrentFrame();
  const t = appear(f, 0, 22);
  return (
    <AbsoluteFill style={{ opacity: sceneFade(f, dur), alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 260, height: 260, opacity: t, transform: `scale(${0.86 + t * 0.14})` }}>
        <Img src={staticFile("icon.png")} style={{ width: 260, height: 260 }} />
      </div>
      <Caption start={14} size={128} weight={720} style={{ marginTop: 18, letterSpacing: "-0.045em" }}>
        Quiver
      </Caption>
      <Caption start={24} size={56} weight={600} color={C.ink2} style={{ marginTop: 18, letterSpacing: "-0.03em" }}>
        One skill library for <Accent>every coding agent</Accent>.
      </Caption>
    </AbsoluteFill>
  );
}
