# Quiver launch video

Remotion project (React → MP4) that renders the Quiver launch assets. Everything is silent and uses only
Quiver's own icon, the system font (SF Pro / SF Mono) and real screenshots of the app UI.

## Render

```sh
cd video
pnpm install
pnpm render          # renders everything into out/
```

The `render` script runs these steps, and you can run any of them on its own:

| Script                | Output                    | What it is                                         |
| --------------------- | ------------------------- | -------------------------------------------------- |
| `pnpm render:main`    | `out/quiver-product.mp4`  | Main video, 1920×1080, 30 fps, H.264, ~61 s         |
| `pnpm render:teaser`  | `out/quiver-teaser.mp4`   | 14 s social cut                                     |
| `pnpm render:poster`  | `out/quiver-poster.png`   | 1920×1080 poster frame                              |
| `pnpm render:gif`     | `out/quiver-demo.gif`     | 6 s seamless loop of the Matrix filling in (README) |

`render:gif` needs `ffmpeg` on your `PATH` (or `FFMPEG=/path/to/ffmpeg`). `GIF_WIDTH` and `GIF_FPS` adjust its size;
the script fails if the GIF goes over 6 MB.

`pnpm studio` opens Remotion Studio for scrubbing and editing.

## Re-capturing the UI footage

The product shots in `public/capture/` are real screenshots of the app running in the browser against its mock
backend (no real user data). To refresh them after a UI change:

```sh
(cd ../app && pnpm dev)   # http://localhost:1420
pnpm capture              # drives the UI with Playwright (uses installed Google Chrome)
```

`scripts/capture.mjs` takes 1240×780 screenshots at 2x of the current native UI (system-blue accent, white cards on
#f5f5f7). The story it captures, in order:

1. **Library**: the grid of cards grouped by source, plus a tall capture of the whole grid that the video scrolls
   under the fixed toolbar.
2. **Skill sheet**: opens a card, then captures the sheet tall (all of its content) so the video can scroll SKILL.md,
   open **Agents** and flip a switch.
3. **Updates**: **Update All** in the Library's attention bar, including the "overwrite local edits" confirmation.
4. **My Skills**: type a commit message and commit.
5. **Agents**: the detected agents, flipping Windsurf from Copy to Symlink.
6. **Matrix**: the first-run sheet and **Make everything universal**, then **Health** for the conflict that is left.
7. **Install**: `expo/skills` from the Install sheet.

It also writes `boxes.json`: the on-screen centre and size of every button or field the cursor visits, the position
of boxes inside the sheet (relative to its corner), and which Matrix cells change between before and after. The
scenes import that file, so cursor moves and camera zooms follow the UI after a re-capture. Set
`PW_CHANNEL=chromium` to use Playwright's bundled Chromium instead of Chrome.

The Matrix "fill" is built from the real before and after screenshots: `MatrixFill` in `src/components/Screen.tsx`
reveals the after state cell by cell, but only for the cells `capture.mjs` measured as different, using the grid
geometry from `app/src/views/Matrix.tsx`. If that layout changes, update the constants at the top of that section
(and the matching ones in `capture.mjs`).

## Layout

```
src/Root.tsx              compositions and scene timing (Product, Teaser, Poster, DemoLoop)
src/theme.ts              the app's own tokens (system blue, neutral greys, #f5f5f7), fonts, easing helpers
src/components/           background, captions, agent tiles, app window, camera, cursor, scroll pane, matrix fill
src/scenes/               Hook, Problem, Reveal, Tour (product footage), HowItWorks, Cli, Outro, Poster, DemoLoop
scripts/capture.mjs       Playwright capture of the real UI (stills + boxes.json)
scripts/gif.mjs           DemoLoop → optimised GIF
```

## Notes

- `remotion.config.ts` deliberately leaves Chrome's default GL backend. Forcing `angle` made the headless browser
  hang on "Waiting for root component to load" on macOS.
- Remotion may print a zod version warning at startup. Renders aren't affected.
