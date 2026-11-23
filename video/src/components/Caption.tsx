import { CSSProperties, ReactNode } from "react";
import { useCurrentFrame } from "remotion";
import { appear, C } from "../theme";

/** Large headline that rises 18px and fades in. */
export function Caption({
  children,
  start = 0,
  size = 64,
  color = C.ink,
  weight = 680,
  style,
}: {
  children: ReactNode;
  start?: number;
  size?: number;
  color?: string;
  weight?: number;
  style?: CSSProperties;
}) {
  const f = useCurrentFrame();
  const t = appear(f, start, 18);
  return (
    <div
      style={{
        fontSize: size,
        fontWeight: weight,
        letterSpacing: "-0.03em",
        lineHeight: 1.08,
        color,
        opacity: t,
        transform: `translateY(${(1 - t) * 18}px)`,
        textAlign: "center",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Emphasis in the system accent colour. Solid, never a gradient. */
export function Accent({ children }: { children: ReactNode }) {
  return <span style={{ color: C.accent }}>{children}</span>;
}
