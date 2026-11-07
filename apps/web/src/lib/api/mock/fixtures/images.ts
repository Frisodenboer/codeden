/** Procedurally drawn SVG images for mock artifacts, screenshots and browser frames. */

function svgUrl(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** A CI failure screenshot: a test report with one red row. */
export function ciFailureShot(): string {
  const rows = [
    ["checkout › guest can pay with card", "pass"],
    ["checkout › applies discount code", "pass"],
    ["checkout › totals update after quantity change", "fail"],
    ["checkout › shows order confirmation", "pass"],
  ];
  const body = rows
    .map(([name, state], i) => {
      const y = 92 + i * 44;
      const color = state === "fail" ? "#f87171" : "#4ade80";
      const bg = state === "fail" ? "#3b1d1d" : "transparent";
      return `<rect x="24" y="${y - 26}" width="592" height="38" rx="6" fill="${bg}"/>
        <circle cx="44" cy="${y - 7}" r="6" fill="${color}"/>
        <text x="62" y="${y - 2}" fill="#e5e7eb" font-size="14" font-family="ui-monospace,monospace">${name}</text>`;
    })
    .join("");
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="300" viewBox="0 0 640 300">
    <rect width="640" height="300" fill="#111318"/>
    <rect width="640" height="40" fill="#1a1d24"/>
    <text x="24" y="26" fill="#9ca3af" font-size="13" font-family="ui-sans-serif,sans-serif">CI · e2e (chromium) · run 4182 · 1 failed, 3 passed</text>
    ${body}
    <text x="24" y="276" fill="#f87171" font-size="12" font-family="ui-monospace,monospace">Error: expect(locator).toHaveText("$84.00") — received "$42.00" (timeout 5000ms)</text>
  </svg>`);
}

/** A generated illustration: soft gradient hills with a glowing den. */
export function generatedIllustration(seed = 0): string {
  const hue = (30 + seed * 47) % 360;
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="768" height="432" viewBox="0 0 768 432">
    <defs>
      <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="hsl(${hue + 200},45%,14%)"/>
        <stop offset="1" stop-color="hsl(${hue + 180},40%,30%)"/>
      </linearGradient>
      <radialGradient id="sun" cx="0.68" cy="0.38" r="0.3">
        <stop offset="0" stop-color="hsl(${hue},95%,72%)" stop-opacity="0.95"/>
        <stop offset="1" stop-color="hsl(${hue},95%,60%)" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="768" height="432" fill="url(#sky)"/>
    <rect width="768" height="432" fill="url(#sun)"/>
    <path d="M0 300 C140 230 260 280 380 250 S620 200 768 260 V432 H0Z" fill="hsl(${hue + 170},30%,22%)"/>
    <path d="M0 350 C160 300 300 360 440 320 S660 300 768 330 V432 H0Z" fill="hsl(${hue + 160},28%,15%)"/>
    <path d="M330 330 l54 -32 l54 32 v44 l-54 32 l-54 -32z" fill="none" stroke="hsl(${hue},95%,65%)" stroke-width="6" stroke-linejoin="round"/>
    <circle cx="384" cy="352" r="12" fill="hsl(${hue},95%,68%)"/>
  </svg>`);
}

/** Before/after contrast comparison card. */
export function contrastComparison(): string {
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="300" viewBox="0 0 720 300">
    <rect width="720" height="300" fill="#f8fafc"/>
    <rect x="24" y="24" width="324" height="252" rx="14" fill="#ffffff" stroke="#e2e8f0"/>
    <rect x="372" y="24" width="324" height="252" rx="14" fill="#ffffff" stroke="#e2e8f0"/>
    <text x="44" y="58" font-size="13" fill="#94a3b8" font-family="sans-serif">BEFORE · 2.9:1</text>
    <text x="392" y="58" font-size="13" fill="#16a34a" font-family="sans-serif">AFTER · 7.1:1</text>
    <text x="44" y="110" font-size="24" fill="#cbd5e1" font-family="sans-serif" font-weight="600">Linen Throw</text>
    <text x="392" y="110" font-size="24" fill="#0f172a" font-family="sans-serif" font-weight="600">Linen Throw</text>
    <text x="44" y="142" font-size="15" fill="#cbd5e1" font-family="sans-serif">$84.00 · Free shipping</text>
    <text x="392" y="142" font-size="15" fill="#334155" font-family="sans-serif">$84.00 · Free shipping</text>
    <rect x="44" y="196" width="140" height="44" rx="10" fill="#fcd34d"/>
    <text x="72" y="224" font-size="15" fill="#fff7ed" font-family="sans-serif" font-weight="600">Add to cart</text>
    <rect x="392" y="196" width="140" height="44" rx="10" fill="#b45309"/>
    <text x="420" y="224" font-size="15" fill="#ffffff" font-family="sans-serif" font-weight="600">Add to cart</text>
  </svg>`);
}

/** A storefront page as the agent's browser would show it. `step` animates the cursor. */
export function storefrontFrame(step: number, url: string): string {
  const cx = 620 + Math.round(Math.sin(step / 3) * 120);
  const cy = 360 + Math.round(Math.cos(step / 4) * 60);
  const cards = [0, 1, 2]
    .map((i) => {
      const x = 64 + i * 300;
      const hue = [28, 200, 150][i];
      return `<rect x="${x}" y="250" width="270" height="300" rx="16" fill="#ffffff" stroke="#e5e7eb"/>
      <rect x="${x + 16}" y="266" width="238" height="170" rx="10" fill="hsl(${hue},60%,88%)"/>
      <text x="${x + 16}" y="470" font-size="18" fill="#111827" font-family="sans-serif" font-weight="600">${["Linen Throw", "Stoneware Mug", "Oak Side Table"][i]}</text>
      <text x="${x + 16}" y="498" font-size="15" fill="#6b7280" font-family="sans-serif">${["$84.00", "$26.00", "$240.00"][i]}</text>
      <rect x="${x + 16}" y="512" width="110" height="26" rx="7" fill="#b45309"/>`;
    })
    .join("");
  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="640" viewBox="0 0 1024 640">
    <rect width="1024" height="640" fill="#fafaf9"/>
    <rect width="1024" height="64" fill="#ffffff" stroke="#e7e5e4"/>
    <text x="64" y="40" font-size="22" font-family="serif" font-weight="700" fill="#1c1917">Hearth &amp; Co.</text>
    <rect x="560" y="18" width="320" height="30" rx="15" fill="#f5f5f4" stroke="#e7e5e4"/>
    <text x="580" y="38" font-size="14" fill="#a8a29e" font-family="sans-serif">Search products…  "${step % 2 ? "linen" : "lin"}"</text>
    <text x="64" y="130" font-size="40" font-family="serif" font-weight="700" fill="#1c1917">Slow living, made well.</text>
    <text x="64" y="170" font-size="17" fill="#57534e" font-family="sans-serif">Filters: Category · Price · In stock    ${url.replace(/&/g, "&amp;")}</text>
    <rect x="64" y="192" width="88" height="30" rx="15" fill="#1c1917"/>
    <text x="84" y="212" font-size="13" fill="#fff" font-family="sans-serif">Textiles</text>
    <rect x="160" y="192" width="104" height="30" rx="15" fill="#fff" stroke="#d6d3d1"/>
    <text x="178" y="212" font-size="13" fill="#44403c" font-family="sans-serif">Under $100</text>
    ${cards}
    <path d="M${cx} ${cy} l0 22 l6 -6 l5 11 l4 -2 l-5 -11 l8 0z" fill="#111" stroke="#fff" stroke-width="1.5"/>
  </svg>`);
}
