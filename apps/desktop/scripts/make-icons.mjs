// Renders the CodeBench mark (apps/web/public/favicon.svg) into the desktop app's icons:
//   build/icon.png              1024px app icon (electron-builder derives .ico/.icns from it)
//   assets/tray.png, @2x        Windows and Linux tray icon (the full-colour mark)
//   assets/trayTemplate.png, @2x  macOS menu bar template (black on transparent)
//   assets/badge.png            Windows taskbar overlay for "something is waiting"
//   assets/icon.png             256px window icon (Linux)
// Needs Playwright's Chromium (`pnpm --filter @codeden/web exec playwright install chromium`).
// Run with `pnpm --filter @codeden/desktop icons`; the outputs are committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright-core";

const root = resolve(import.meta.dirname, "..");
const BG = "#0f1115";
const AMBER = "#f59e0b";
const BLUE = "#1F9CF0";

/** The mark on its rounded tile, inset so it sits well next to other app icons. */
const appIcon = (inset) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <g transform="translate(${inset} ${inset}) scale(${(32 - inset * 2) / 32})">
    <rect width="32" height="32" rx="7.2" fill="${BG}"/>
    <path d="M9 21V11l7-4 7 4v10l-7 4z" fill="none" stroke="${BLUE}" stroke-width="2.2" stroke-linejoin="round"/>
    <circle cx="16" cy="16" r="2.6" fill="${BLUE}"/>
  </g>
</svg>`;

/** The hexagon alone, for small tray sizes (a tile would read as a blob at 16px). */
const glyph = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 4.5 20 23">
  <path d="M9 21V11l7-4 7 4v10l-7 4z" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round"/>
  <circle cx="16" cy="16" r="3" fill="${color}"/>
</svg>`;

const badge = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <circle cx="8" cy="8" r="7" fill="${AMBER}" stroke="${BG}" stroke-width="1.5"/>
</svg>`;

const outputs = [
  ["build/icon.png", appIcon(2.6), 1024],
  ["assets/icon.png", appIcon(1.2), 256],
  ["assets/tray.png", glyph(BLUE), 16],
  ["assets/tray@2x.png", glyph(BLUE), 32],
  ["assets/trayTemplate.png", glyph("#000000"), 16],
  ["assets/trayTemplate@2x.png", glyph("#000000"), 32],
  ["assets/badge.png", badge, 16],
  ["assets/badge@2x.png", badge, 32],
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [file, svg, size] of outputs) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<html><body style="margin:0;background:transparent">${svg.replace(
        "<svg ",
        `<svg width="${size}" height="${size}" `,
      )}</body></html>`,
    );
    const png = await page.screenshot({
      omitBackground: true,
      clip: { x: 0, y: 0, width: size, height: size },
    });
    const out = resolve(root, file);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
    console.log(`wrote ${file} (${size}px)`);
  }
} finally {
  await browser.close();
}
