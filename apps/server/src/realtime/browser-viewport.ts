import type { BrowserViewportSize } from "@codeden/contracts";

interface Report {
  size: BrowserViewportSize;
  /** When the viewer last claimed the viewport (its first report counts as a weak claim). */
  rank: number;
}

/**
 * Decides which viewer's panel size a session's page follows (§12.2), so a phone opening the
 * panel doesn't resize the page under a desktop viewer:
 *
 * - The first viewer to report a size owns the viewport.
 * - A viewer that claims (it was focused, clicked, or picked a size) becomes the owner.
 * - The page follows the owner's reports; other viewers' reports are only remembered.
 * - When the owner leaves, the remaining viewer that claimed most recently takes over
 *   (viewers that never claimed rank by when they first reported).
 */
export class ViewportArbiter {
  private readonly reports = new Map<string, Report>();
  private owner: string | undefined;
  private clock = 0;

  get ownerId(): string | undefined {
    return this.owner;
  }

  /** The size the page should have, or undefined when no viewer reported one. */
  get size(): BrowserViewportSize | undefined {
    return this.owner ? this.reports.get(this.owner)?.size : undefined;
  }

  get viewers(): number {
    return this.reports.size;
  }

  /** Record a viewer's size. Returns true when the owner's size (what the page follows) changed. */
  report(viewerId: string, size: BrowserViewportSize, claim = false): boolean {
    const before = this.size;
    const previous = this.reports.get(viewerId);
    const rank = claim || !previous ? ++this.clock : previous.rank;
    this.reports.set(viewerId, { size: { ...size }, rank });
    if (claim || this.owner === undefined) this.owner = viewerId;
    return !sameSize(before, this.size);
  }

  /** Forget a viewer. Returns true when the owner's size changed (ownership passed on). */
  remove(viewerId: string): boolean {
    const before = this.size;
    if (!this.reports.delete(viewerId)) return false;
    if (this.owner !== viewerId) return false;
    let next: [string, Report] | undefined;
    for (const entry of this.reports) if (!next || entry[1].rank > next[1].rank) next = entry;
    this.owner = next?.[0];
    return next !== undefined && !sameSize(before, this.size);
  }
}

function sameSize(a: BrowserViewportSize | undefined, b: BrowserViewportSize | undefined): boolean {
  return (
    a?.width === b?.width &&
    a?.height === b?.height &&
    a?.deviceScaleFactor === b?.deviceScaleFactor
  );
}
