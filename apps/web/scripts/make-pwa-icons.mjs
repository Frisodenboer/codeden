// Renders the CodeDen mark (public/favicon.svg) into the web app manifest icons:
//   public/icons/icon-192.png, icon-512.png          rounded tile ("any")
//   public/icons/maskable-192.png, maskable-512.png  full-bleed, mark inside the safe zone
//   public/apple-touch-icon.png                      180px, full-bleed (iOS rounds it)
// Needs Playwright's Chromium (`pnpm --filter @codeden/web exec playwright install chromium`).
// Run with `pnpm --filter @codeden/web icons`; the outputs are committed.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "@playwright/test";

const root = resolve(import.meta.dirname, "..");
/** The dark theme's `--background` token (oklch(0.165 0.008 264)). */
const BG = "#0d0e12";
const AMBER = "#f59e0b";

const mark = `
  <path d="M9 21V11l7-4 7 4v10l-7 4z" fill="none" stroke="${AMBER}" stroke-width="2.2" stroke-linejoin="round"/>
  <circle cx="16" cy="16" r="2.6" fill="${AMBER}"/>`;

/** The mark on its rounded tile with transparent corners. */
const tile = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7.2" fill="${BG}"/>${mark}
</svg>`;

/** Full-bleed background; the mark scaled to `scale` of the side, centred. */
const fullBleed = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" fill="${BG}"/>
  <g transform="translate(${16 - 16 * scale} ${16 - 16 * scale}) scale(${scale})">${mark}</g>
</svg>`;

const outputs = [
  ["public/icons/icon-192.png", tile, 192],
  ["public/icons/icon-512.png", tile, 512],
  // Maskable icons are cropped to a circle of 80% of the side: keep the mark well inside it.
  ["public/icons/maskable-192.png", fullBleed(0.62), 192],
  ["public/icons/maskable-512.png", fullBleed(0.62), 512],
  ["public/apple-touch-icon.png", fullBleed(0.8), 180],
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
