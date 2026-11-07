/** Unified patches shared by transcript fixtures and the diff panel. */

/**
 * Hand-written fixture patches: give blank context lines their leading space and recompute
 * every hunk header's line counts so strict parsers accept them.
 */
export function normalizePatch(patch: string): string {
  const lines = patch.replace(/\n$/, "").split("\n");
  const out: string[] = [];
  let header = -1;
  let oldCount = 0;
  let newCount = 0;
  const closeHunk = () => {
    if (header < 0) return;
    out[header] = (out[header] ?? "").replace(
      /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/,
      (_m, a, b) => `@@ -${a},${oldCount} +${b},${newCount} @@`,
    );
  };
  for (const raw of lines) {
    if (raw.startsWith("@@")) {
      closeHunk();
      header = out.length;
      oldCount = 0;
      newCount = 0;
      out.push(raw);
      continue;
    }
    if (
      header < 0 ||
      raw.startsWith("diff ") ||
      raw.startsWith("index ") ||
      raw.startsWith("---") ||
      raw.startsWith("+++")
    ) {
      out.push(raw);
      continue;
    }
    const line = raw === "" ? " " : raw;
    if (line.startsWith("+")) newCount++;
    else if (line.startsWith("-")) oldCount++;
    else {
      oldCount++;
      newCount++;
    }
    out.push(line);
  }
  closeHunk();
  return `${out.join("\n")}\n`;
}

export const specPatch =
  normalizePatch(`diff --git a/tests/e2e/checkout.spec.ts b/tests/e2e/checkout.spec.ts
index 3f1c2aa..8b9e0d4 100644
--- a/tests/e2e/checkout.spec.ts
+++ b/tests/e2e/checkout.spec.ts
@@ -18,14 +18,17 @@ test.describe("checkout", () => {
   test("totals update after quantity change", async ({ page }) => {
     await page.goto("/cart");
     const row = page.getByRole("row", { name: /Linen Throw/ });
-    await row.getByRole("spinbutton").fill("2");
-    await page.waitForTimeout(500);
-    await expect(page.getByTestId("cart-total")).toHaveText("$84.00");
+    const priced = page.waitForResponse(
+      (res) => res.url().endsWith("/api/cart/price") && res.ok(),
+    );
+    await row.getByRole("spinbutton").fill("2");
+    await priced;
+    await expect(page.getByTestId("cart-total")).toHaveText("$84.00");
   });

   test("shows order confirmation", async ({ page }) => {
-    await page.goto("/checkout");
+    await page.goto("/checkout", { waitUntil: "networkidle" });
     await page.getByLabel("Card number").fill("4242 4242 4242 4242");
`);

export const cartPatch =
  normalizePatch(`diff --git a/src/checkout/useCart.ts b/src/checkout/useCart.ts
index 91ab7c0..d24f8e1 100644
--- a/src/checkout/useCart.ts
+++ b/src/checkout/useCart.ts
@@ -31,18 +31,24 @@ export function useCart() {
   const [lines, setLines] = useState<CartLine[]>([]);
   const [total, setTotal] = useState(0);
+  const requestId = useRef(0);

   const updateQuantity = useCallback(async (sku: string, quantity: number) => {
     setLines((prev) => prev.map((l) => (l.sku === sku ? { ...l, quantity } : l)));
-    const res = await fetch("/api/cart/price", {
+    const id = ++requestId.current;
+    const res = await fetch("/api/cart/price", {
       method: "POST",
       body: JSON.stringify({ sku, quantity }),
     });
     const { total: next } = await res.json();
-    setTotal(next);
+    // Ignore responses that arrive after a newer request (the source of the flake).
+    if (id === requestId.current) setTotal(next);
   }, []);

   return { lines, total, updateQuantity };
 }
`);

export const searchPatch =
  normalizePatch(`diff --git a/src/search/SearchFilters.tsx b/src/search/SearchFilters.tsx
new file mode 100644
index 0000000..4c1d2e9
--- /dev/null
+++ b/src/search/SearchFilters.tsx
@@ -0,0 +1,22 @@
+import { useSearchParams } from "react-router";
+import { FilterChip } from "./FilterChip";
+
+const CATEGORIES = ["Textiles", "Ceramics", "Furniture", "Lighting"] as const;
+
+export function SearchFilters() {
+  const [params, setParams] = useSearchParams();
+  const active = params.getAll("category");
+
+  const toggle = (category: string) => {
+    const next = active.includes(category)
+      ? active.filter((c) => c !== category)
+      : [...active, category];
+    setParams({ ...Object.fromEntries(params), category: next });
+  };
+
+  return (
+    <div className="flex gap-2">
+      {CATEGORIES.map((c) => <FilterChip key={c} label={c} active={active.includes(c)} onClick={() => toggle(c)} />)}
+    </div>
+  );
+}
`);

export const indexPatch = normalizePatch(`diff --git a/src/search/index.ts b/src/search/index.ts
index 5d02a11..77ac9b0 100644
--- a/src/search/index.ts
+++ b/src/search/index.ts
@@ -4,9 +4,15 @@ import { products } from "../data/products";
 export interface SearchQuery {
   text: string;
+  categories?: string[];
+  maxPrice?: number;
 }

-export function search({ text }: SearchQuery) {
-  return products.filter((p) => p.name.toLowerCase().includes(text.toLowerCase()));
+export function search({ text, categories = [], maxPrice }: SearchQuery) {
+  const needle = text.trim().toLowerCase();
+  return products.filter((p) =>
+    (!needle || p.name.toLowerCase().includes(needle)) &&
+    (categories.length === 0 || categories.includes(p.category)) &&
+    (maxPrice === undefined || p.price <= maxPrice),
+  );
 }
`);

export function countLines(patch: string): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) additions++;
    if (line.startsWith("-") && !line.startsWith("---")) deletions++;
  }
  return { additions, deletions };
}
