import { AbsoluteFill } from "remotion";
import { C } from "../theme";

/** The app's own canvas grey. Flat, so nothing competes with the product. */
export function Background() {
  return <AbsoluteFill style={{ background: C.canvas }} />;
}
