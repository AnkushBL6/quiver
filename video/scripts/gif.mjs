// Renders the DemoLoop composition and converts it to an optimised, looping GIF for the README.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, statSync } from "node:fs";

const FFMPEG = process.env.FFMPEG ?? "ffmpeg";
const WIDTH = Number(process.env.GIF_WIDTH ?? 1240);
const FPS = Number(process.env.GIF_FPS ?? 20);
mkdirSync("out", { recursive: true });
const tmp = "out/.demo-loop.mp4";

execFileSync("npx", ["remotion", "render", "src/index.ts", "DemoLoop", tmp, "--codec", "h264", "--crf", "12", "--log", "error"], { stdio: "inherit" });
const filters = `fps=${FPS},scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`;
execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-i", tmp, "-filter_complex", filters, "-loop", "0", "out/quiver-demo.gif"], { stdio: "inherit" });
rmSync(tmp);
const mb = statSync("out/quiver-demo.gif").size / 1e6;
console.log(`out/quiver-demo.gif ${mb.toFixed(2)} MB`);
if (mb > 6) {
  console.error("GIF is over 6 MB; lower GIF_WIDTH or GIF_FPS.");
  process.exit(1);
}
