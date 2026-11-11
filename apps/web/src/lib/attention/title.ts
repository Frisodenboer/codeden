/**
 * The tab title cue: while the tab is in the background and an agent waits on the user, the
 * title alternates between the usual "(N) CodeDen" and "(N) ⏳ Waiting on you · CodeDen". The
 * unread count stays in both. When flashing stops the usual title comes back.
 */

export const APP_TITLE = "CodeBench";
export const WAITING_TITLE = "⏳ Waiting on you · CodeBench";
export const TITLE_FLASH_MS = 1500;

/** "(3) CodeDen", or the bare title with nothing open. */
export function countedTitle(count: number, title: string = APP_TITLE): string {
  return count > 0 ? `(${count}) ${title}` : title;
}

export interface TitleState {
  /** Open inbox items, shown as "(N)". */
  count: number;
  /** Alternate with the waiting title. */
  flashing: boolean;
}

export interface TitleFlasher {
  update(state: TitleState): void;
  /** Stop flashing and put the usual title back. */
  stop(): void;
}

export interface TitleFlasherOptions {
  doc?: Document;
  intervalMs?: number;
}

export function createTitleFlasher(opts: TitleFlasherOptions = {}): TitleFlasher {
  const doc = opts.doc ?? document;
  const intervalMs = opts.intervalMs ?? TITLE_FLASH_MS;
  let timer: ReturnType<typeof setInterval> | null = null;
  let showWaiting = false;
  let count = 0;

  const render = () => {
    doc.title = countedTitle(count, showWaiting ? WAITING_TITLE : APP_TITLE);
  };

  const stop = () => {
    // Only touch the title if we changed it: otherwise the badge owns it.
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
    showWaiting = false;
    render();
  };

  return {
    update(state) {
      count = state.count;
      if (!state.flashing) return stop();
      if (timer === null) {
        showWaiting = true;
        timer = setInterval(() => {
          showWaiting = !showWaiting;
          render();
        }, intervalMs);
      }
      render();
    },
    stop,
  };
}
