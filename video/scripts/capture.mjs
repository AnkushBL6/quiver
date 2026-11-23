// Captures real Quiver UI stills (2x) from the mock-backed dev server.
// Usage: (cd ../app && pnpm dev) then `pnpm capture`. Writes public/capture/*.png + boxes.json.
//
// Every still is the app at 1240x780 CSS px. A few are "tall": the Library grid and the skill sheet are
// captured in a taller window so the video can scroll them under a fixed toolbar. Boxes are in app (CSS px)
// coordinates: { x, y } is the centre of the element, { w, h } its size. Boxes inside the skill sheet are
// relative to the sheet's top-left corner instead (keys starting with "sheet.").
import { chromium } from "playwright";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";

const BASE = process.env.QUIVER_URL ?? "http://localhost:1420/";
const OUT = new URL("../public/capture/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".png") || f === "boxes.json") rmSync(OUT + f);

const W = 1240;
const H = 780;
const LIB_TALL_H = 2000;
const SHEET_TALL_H = 2800;
const boxes = {};

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? "chrome" });
async function page(height = H, scheme = "light") {
  const ctx = await browser.newContext({ viewport: { width: W, height }, deviceScaleFactor: 2, colorScheme: scheme });
  await ctx.addInitScript(() => localStorage.setItem("quiver.onboarded.v1", "1"));
  return ctx.newPage();
}
const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.png` }).then(() => console.log("shot", name));
const settle = (p, ms = 900) => p.waitForTimeout(ms);
// Hide the text caret (the video draws its own) and park the pointer on empty sidebar so no hover leaks into stills.
const clean = (p) => p.addStyleTag({ content: "*{caret-color:transparent!important}" });
const neutral = (p) => p.mouse.move(100, 470);
const round = (n) => Math.round(n * 100) / 100;
async function box(name, locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`no box for ${name}`);
  boxes[name] = { x: round(b.x + b.width / 2), y: round(b.y + b.height / 2), w: round(b.width), h: round(b.height) };
  return b;
}
/** Box relative to a container's top-left corner (the skill sheet). */
async function relBox(name, locator, container) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`no box for ${name}`);
  boxes[name] = { x: round(b.x - container.x + b.width / 2), y: round(b.y - container.y + b.height / 2), w: round(b.width), h: round(b.height) };
}
/** Where typed text starts, how tall and wide the field's inner area is, and how wide `text` renders. */
async function fieldBox(name, locator, text) {
  const b = await locator.boundingBox();
  const m = await locator.evaluate((el, t) => {
    const cs = getComputedStyle(el);
    const ctx = document.createElement("canvas").getContext("2d");
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    return {
      padL: parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth),
      padT: parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth),
      fontSize: parseFloat(cs.fontSize),
      lineHeight: parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3,
      text: ctx.measureText(t).width,
    };
  }, text);
  boxes[name] = { x: round(b.x + m.padL), y: round(b.y + m.padT), w: round(b.width), h: round(b.height), textW: round(m.text), lineH: round(m.lineHeight), padL: round(m.padL), padT: round(m.padT) };
}
const scrollLibrary = (p, y) => p.evaluate((top) => document.querySelector(".scroll.\\@container")?.scrollTo(0, top), y);

// ── 1. Library: the grid, the tall version for scrolling, and the attention bar ─────────────────────────
{
  const p = await page();
  await p.goto(BASE + "?onboarding=0#/library");
  await settle(p, 1600);
  await clean(p);
  await neutral(p);
  await shot(p, "library");
  await box("library.card", p.locator('[data-card][data-id="algorithmic-art"]'));
  await box("library.updatesLabel", p.getByRole("button", { name: /updates? available/ }).first());
  await box("library.updateAll", p.getByRole("button", { name: "Update All", exact: true }).first());
  await box("library.attention", p.getByRole("button", { name: /need attention/ }).first());
  await box("library.sectionUpdateAll", p.getByRole("button", { name: /^Update All \(\d+\)/ }).first());
  await p.context().close();
}
{
  const p = await page(LIB_TALL_H);
  await p.goto(BASE + "?onboarding=0#/library");
  await settle(p, 1800);
  await clean(p);
  await neutral(p);
  await shot(p, "library-tall");
  await p.context().close();
}
boxes["library.tallH"] = LIB_TALL_H;

// ── 2. Skill sheet: open a card, read SKILL.md, open Agents, flip a switch ─────────────────────────────
{
  const p = await page();
  await p.goto(BASE + "?onboarding=0#/library");
  await settle(p, 1500);
  await clean(p);
  await neutral(p);
  const card = p.locator('[data-card][data-id="algorithmic-art"]');
  await card.hover();
  await settle(p, 350);
  await shot(p, "library-card-hover");
  await card.click();
  await settle(p, 1400);
  await p.mouse.move(1120, 420);
  await shot(p, "sheet-open");
  const dlg = p.locator('[role="dialog"][aria-modal="true"]');
  const d = await dlg.boundingBox();
  boxes["sheet.dialog"] = { x: round(d.x), y: round(d.y), w: round(d.width), h: round(d.height) };

  // Same sheet in a tall window so its whole content can scroll in the video.
  await p.setViewportSize({ width: W, height: SHEET_TALL_H });
  await settle(p, 800);
  const a = await dlg.boundingBox();
  await relBox("sheet.agentsHeader", dlg.getByRole("button", { name: /^Agents/ }), a);
  await dlg.screenshot({ path: `${OUT}sheet-tall-a.png` });
  boxes["sheet.heightA"] = round(a.height);

  await dlg.getByRole("button", { name: /^Agents/ }).click();
  await settle(p, 800);
  const b = await dlg.boundingBox();
  const sw = dlg.getByRole("switch", { name: /^Cursor/ });
  await relBox("sheet.cursorSwitch", sw, b);
  await relBox("sheet.agentsHeaderOpen", dlg.getByRole("button", { name: /^Agents/ }), b);
  boxes["sheet.heightB"] = round(b.height);
  boxes["sheet.cursorWasOn"] = (await sw.getAttribute("aria-checked")) === "true";
  await dlg.screenshot({ path: `${OUT}sheet-tall-b.png` });

  await sw.click();
  await settle(p, 1000);
  await dlg.screenshot({ path: `${OUT}sheet-tall-c.png` });
  boxes["sheet.cursorNowOn"] = (await sw.getAttribute("aria-checked")) === "true";
  await relBox("sheet.close", dlg.getByRole("button", { name: /^Close/ }), b);

  // Back to the normal window, close the sheet: the card no longer says "Not in Cursor".
  await p.setViewportSize({ width: W, height: H });
  await settle(p, 500);
  await dlg.getByRole("button", { name: /^Close/ }).click();
  await settle(p, 200);
  await neutral(p);
  await settle(p, 1200);
  await shot(p, "library-shared");
  await p.context().close();
}

// ── 3. Update everything from the Library's attention bar ──────────────────────────────────────────────
{
  const p = await page();
  await p.goto(BASE + "?onboarding=0#/library");
  await settle(p, 1500);
  await clean(p);
  const upd = p.getByRole("button", { name: "Update All", exact: true }).first();
  await upd.click();
  await settle(p, 160);
  await neutral(p);
  await shot(p, "updates-busy");
  const confirm = p.getByRole("button", { name: "Update Anyway" });
  await confirm.waitFor({ timeout: 10000 });
  await settle(p, 700);
  await box("updates.confirm", confirm);
  await box("updates.cancel", p.getByRole("button", { name: "Cancel" }));
  await shot(p, "updates-confirm");
  await confirm.click();
  await settle(p, 160);
  await neutral(p);
  await settle(p, 1500);
  await shot(p, "updates-done");
  await p.context().close();
}

// ── 4. My Skills: write a commit message and commit ────────────────────────────────────────────────────
{
  const p = await page();
  await p.goto(BASE + "?onboarding=0#/mine");
  await settle(p, 1500);
  await clean(p);
  await neutral(p);
  await shot(p, "mine");
  const ta = p.getByPlaceholder("Commit message");
  const msg = "Tighten the PR description template";
  await box("mine.message", ta);
  await box("mine.commit", p.getByRole("button", { name: /^Commit/ }));
  await box("mine.change", p.getByText("Uncommitted Changes").first());
  await ta.click();
  await settle(p, 250);
  await neutral(p);
  await shot(p, "mine-focus");
  await ta.pressSequentially(msg, { delay: 10 });
  await settle(p, 250);
  await fieldBox("mine.field", ta, msg);
  boxes["mine.chars"] = msg.length;
  await shot(p, "mine-typed");
  await p.getByRole("button", { name: /^Commit/ }).click();
  await settle(p, 1400);
  await neutral(p);
  await shot(p, "mine-done");
  await p.context().close();
}

// ── 5. Agents: every detected agent, flip Windsurf from Copy to Symlink ─────────────────────────────────
{
  const p = await page();
  await p.goto(BASE + "?onboarding=0#/agents");
  await settle(p, 1500);
  await clean(p);
  await neutral(p);
  await shot(p, "agents");
  const seg = p.getByRole("tablist", { name: "Windsurf install mode" }).getByRole("tab", { name: "Symlink" });
  await box("agents.windsurfSymlink", seg);
  await box("agents.list", p.getByRole("button", { name: /Show Claude Code's skills/ }));
  await box("agents.cursorRow", p.getByRole("button", { name: /Show Cursor's skills/ }));
  await seg.click();
  await settle(p, 600);
  await neutral(p);
  await shot(p, "agents-after");
  await p.context().close();
}

// ── 6. Make everything universal (Matrix), then clear what's left in Health ────────────────────────────
{
  const p = await page();
  await p.goto(BASE + "?onboarding=0#/matrix");
  await settle(p, 1500);
  await clean(p);
  await neutral(p);
  await shot(p, "matrix-before");
  await p.goto(BASE + "?onboarding=1#/matrix");
  await settle(p, 1600);
  await clean(p);
  await neutral(p);
  await shot(p, "onboarding");
  const btn = p.getByRole("button", { name: /Make everything universal/ });
  await box("onboarding.button", btn);
  await btn.hover();
  await settle(p, 300);
  await shot(p, "onboarding-hover");
  await btn.click();
  await settle(p, 140);
  await shot(p, "onboarding-busy");
  await p.getByText("Every skill is universal").first().waitFor({ timeout: 15000 });
  await settle(p, 800);
  await neutral(p);
  await shot(p, "onboarding-done");
  await box("onboarding.start", p.getByRole("button", { name: /Get started/ }));
  await p.keyboard.press("Escape");
  await settle(p, 900);
  await neutral(p);
  await shot(p, "matrix-after-toast");
  await box("matrix.toast", p.locator("[data-sonner-toast]").first());
  await p.waitForTimeout(4200);
  await shot(p, "matrix-after");

  // What's left is a real conflict that needs a human: choose which copy to keep.
  await p.getByRole("button", { name: /^Health/ }).click();
  await settle(p, 1400);
  await neutral(p);
  await shot(p, "health");
  const keep = p.getByRole("button", { name: "Keep This One" }).nth(1);
  await box("health.keep", keep);
  await box("health.conflict", p.getByText("code-review").first());
  await keep.click();
  await settle(p, 200);
  await neutral(p);
  await settle(p, 1200);
  await shot(p, "health-done");
  await p.context().close();
}

// ── 7. Install from GitHub ─────────────────────────────────────────────────────────────────────────────
{
  const p = await page();
  await p.goto(BASE + "?onboarding=0#/library");
  await settle(p, 1500);
  await clean(p);
  const side = p.getByRole("button", { name: /Install Skill/ });
  await box("install.sidebar", side);
  await side.click();
  await settle(p, 900);
  await neutral(p);
  await shot(p, "install-empty");
  const input = p.getByPlaceholder(/owner\/repo/);
  const text = "expo/skills";
  await box("install.input", input);
  await input.click();
  await settle(p, 200);
  await shot(p, "install-focus");
  await input.pressSequentially(text, { delay: 20 });
  await settle(p, 250);
  await fieldBox("install.field", input, text);
  boxes["install.chars"] = text.length;
  await shot(p, "install-typed");
  await box("install.continue", p.getByRole("button", { name: /^Continue/ }));
  await input.press("Enter");
  await p.getByText("Select all").first().waitFor({ timeout: 10000 });
  await settle(p, 1000);
  await shot(p, "install-resolved");
  await box("install.selectAll", p.getByText("Select all").first());
  await p.getByText("Select all").first().click();
  await settle(p, 400);
  await neutral(p);
  await shot(p, "install-selected");
  const go = p.getByRole("button", { name: /^Install \d+ skills?$/ });
  await box("install.go", go);
  await go.click();
  await settle(p, 400);
  await shot(p, "install-busy");
  await p.waitForTimeout(2600);
  await neutral(p);
  await shot(p, "install-done");
  await p.context().close();
}

// ── Which Matrix cells does "Make everything universal" actually change? ───────────────────────────────
// The video reveals matrix-after over matrix-before cell by cell; only the cells that differ should animate.
// Geometry is from app/src/views/Matrix.tsx (sidebar 208, toolbar 52, header 124, name 280, col 40, row 34, reach 84).
{
  const p = await page();
  await p.goto("about:blank");
  const b64 = (n) => readFileSync(`${OUT}${n}.png`).toString("base64");
  const diff = await p.evaluate(
    async ({ before, after }) => {
      const load = (b) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = `data:image/png;base64,${b}`;
        });
      const [a, b] = await Promise.all([load(before), load(after)]);
      const px = (img) => {
        const c = document.createElement("canvas");
        c.width = img.width;
        c.height = img.height;
        const x = c.getContext("2d");
        x.drawImage(img, 0, 0);
        return x.getImageData(0, 0, img.width, img.height);
      };
      const A = px(a);
      const B = px(b);
      const S = 2;
      const changed = (x0, y0, w, h) => {
        let n = 0;
        for (let y = Math.round(y0 * S); y < Math.round((y0 + h) * S); y++)
          for (let x = Math.round(x0 * S); x < Math.round((x0 + w) * S); x++) {
            const i = (y * A.width + x) * 4;
            if (Math.abs(A.data[i] - B.data[i]) + Math.abs(A.data[i + 1] - B.data[i + 1]) + Math.abs(A.data[i + 2] - B.data[i + 2]) > 36) n++;
          }
        return n > 4;
      };
      const GX = 488, GY = 176, ROW = 34, COL = 40;
      const cells = [];
      const rows = [];
      for (let r = 0; r < 17; r++) {
        const y = GY + r * ROW;
        if (y + 24 > 748) continue;
        let rowChanged = changed(209, y + 1, 279, ROW - 2) || changed(GX + 12 * COL, y + 1, 84, ROW - 2);
        for (let c = 0; c < 12; c++) if (changed(GX + c * COL + 8, y + 5, 24, 24)) cells.push([r, c]);
        if (rowChanged) rows.push(r);
      }
      return { cells, rows };
    },
    { before: b64("matrix-before"), after: b64("matrix-after") },
  );
  boxes["matrix.cells"] = diff.cells;
  boxes["matrix.rows"] = diff.rows;
  console.log("matrix cells changed:", diff.cells.length, "rows with text changes:", diff.rows);
  await p.context().close();
}

writeFileSync(`${OUT}boxes.json`, JSON.stringify(boxes, null, 2));
await browser.close();
console.log(boxes);
