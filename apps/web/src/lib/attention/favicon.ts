/**
 * The favicon badge: while an agent waits on the user, the tab icon gets an amber dot, drawn on
 * a canvas from the page's own favicon. Restoring puts the original link back exactly. Rendering
 * failures leave the original icon in place.
 */

const SIZE = 64;
const DOT = "#f59e0b";
/** The favicon's own background, used as a ring so the dot stands out from the amber mark. */
const RING = "#0f1115";

export interface FaviconBadge {
  /** Show the badge (`true`) or restore the original icon (`false`). */
  set(active: boolean): void;
}

export interface FaviconBadgeOptions {
  doc?: Document;
  loadImage?: (src: string) => Promise<CanvasImageSource>;
}

/** Draw `image` with an amber dot (and a dark ring) in the top-right corner. */
export function drawBadge(ctx: CanvasRenderingContext2D, image: CanvasImageSource, size: number) {
  const radius = size * 0.2;
  const ring = size * 0.05;
  const cx = size - radius - ring;
  const cy = radius + ring;
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(image, 0, 0, size, size);
  ctx.beginPath();
  ctx.arc(cx, cy, radius + ring, 0, Math.PI * 2);
  ctx.fillStyle = RING;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = DOT;
  ctx.fill();
}

function loadBrowserImage(src: string): Promise<CanvasImageSource> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

export function createFaviconBadge(opts: FaviconBadgeOptions = {}): FaviconBadge {
  const doc = opts.doc ?? document;
  const loadImage = opts.loadImage ?? loadBrowserImage;
  let original: { href: string; type: string } | null = null;
  let badged: string | null = null;
  let pending: Promise<string | null> | null = null;
  let active = false;

  const link = () => doc.querySelector<HTMLLinkElement>('link[rel~="icon"]');

  const render = async (src: string): Promise<string | null> => {
    try {
      const image = await loadImage(src);
      const canvas = doc.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      drawBadge(ctx, image, SIZE);
      return canvas.toDataURL("image/png");
    } catch {
      return null;
    }
  };

  const apply = (el: HTMLLinkElement, url: string | null) => {
    // The badge may have been turned off while the image was loading.
    if (!active || !url) return;
    el.setAttribute("type", "image/png");
    el.setAttribute("href", url);
    el.dataset.attention = "waiting";
  };

  return {
    set(next) {
      if (next === active) return;
      active = next;
      const el = link();
      if (!el) return;
      original ??= { href: el.getAttribute("href") ?? "/favicon.svg", type: el.type };
      if (!next) {
        el.setAttribute("href", original.href);
        if (original.type) el.setAttribute("type", original.type);
        else el.removeAttribute("type");
        delete el.dataset.attention;
        return;
      }
      if (badged) return apply(el, badged);
      pending ??= render(original.href).then((url) => {
        badged = url;
        pending = null;
        return url;
      });
      void pending.then((url) => apply(el, url));
    },
  };
}
