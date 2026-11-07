import type { Item } from "@codeden/contracts";
import { cmd } from "./fixtures/item-builders";
import { Script, streamSteps, uid } from "./live";
import type { MockWorld } from "./world";

const searchLines = [
  " ✓ src/search/price-slider.test.tsx (4 tests) 96ms\n",
  " ✓ src/routes/products.test.tsx (7 tests) 240ms\n",
  "\n Test Files  4 passed (4)\n",
  "      Tests  26 passed (26)\n",
  "   Duration  1.84s\n",
].join("");

const searchNotes = [
  "All search tests pass. Wiring the max-price slider into the URL next, debounced so typing doesn't spam history entries.",
  "The slider now writes `maxPrice` to the URL. Adding a screenshot of the filtered results as evidence for PR #57.",
  "Evidence attached. Re-running the e2e search spec against the dev server.",
];

/** Keep the "Add product search" session visibly working: output, notes, new commands. */
function searchLoop(world: MockWorld): Script {
  const sessionId = "s-search";
  const ids = { sessionId, threadId: "t-search", turnId: "se-turn-1" };
  let round = 0;
  let commandId = "se-t6";
  const roundSteps = () => {
    const note = searchNotes[round % searchNotes.length] ?? "";
    const noteId = uid("se-a");
    const nextCommand = uid("se-c");
    const command =
      round % 2 === 0 ? "pnpm exec playwright test search" : "pnpm vitest run src/search";
    const current = commandId;
    const steps = [
      ...streamSteps(world, { ...ids, itemId: current }, searchLines, "tool_output"),
      {
        wait: 600,
        run: () => {
          const prev = world.item(sessionId, current);
          const isCmd = prev?.kind === "tool_call" && prev.toolKind === "command";
          const text = isCmd ? (prev.output?.text ?? "") : "";
          const done: Item = cmd(current, isCmd ? prev.command : command, text, 0, 1840);
          world.emitAgent(sessionId, { type: "item.completed", ...ids, item: done });
          world.emitAgent(sessionId, {
            type: "item.started",
            ...ids,
            item: { id: noteId, kind: "assistant_message", status: "in_progress", text: "" },
          });
        },
      },
      ...streamSteps(world, { ...ids, itemId: noteId }, note, "text", 60),
      {
        wait: 1200,
        run: () => {
          world.emitAgent(sessionId, {
            type: "item.completed",
            ...ids,
            item: { id: noteId, kind: "assistant_message", status: "completed", text: note },
          });
          world.emitAgent(sessionId, {
            type: "item.started",
            ...ids,
            item: cmd(nextCommand, command, "", null),
          });
          world.updateSession(sessionId, {
            progress: { text: note.split(".")[0] ?? note, at: new Date().toISOString() },
          });
          commandId = nextCommand;
          round += 1;
        },
      },
    ];
    return steps;
  };
  // Three rounds is enough to feel alive without growing the transcript forever.
  return new Script([
    { wait: 2500, run: () => {} },
    ...roundSteps(),
    ...roundSteps(),
    ...roundSteps(),
  ]);
}

const reviewMore = [
  " The discount path recomputes the total through the same endpoint, so the guard covers it too.",
  " Test change is good: `waitForResponse` is scoped to `/api/cart/price` and checks `res.ok()`.",
  " Verdict so far: **approve**. Writing the summary…",
];

function reviewStream(world: MockWorld): Script {
  const ids = {
    sessionId: "s-checkout",
    threadId: "t-checkout-review",
    turnId: "rv-turn-1",
    itemId: "rv-5",
  };
  return new Script(
    reviewMore.flatMap((text) => [
      { wait: 2600, run: () => {} },
      ...streamSteps(world, ids, text, "text", 70),
    ]),
  );
}

function auditProgress(world: MockWorld): Script {
  const steps = [
    "Reviewing session handling (4 of 7 areas)",
    "Reviewing input validation (5 of 7 areas)",
  ];
  return new Script(
    steps.map((text) => ({
      wait: 20_000,
      run: () =>
        world.updateSession("s-audit", { progress: { text, at: new Date().toISOString() } }),
    })),
  );
}

/** Start background activity so the mock UI feels live. Returns a stop function. */
export function startAmbient(world: MockWorld): () => void {
  const scripts = [searchLoop(world), reviewStream(world), auditProgress(world)].map((s) =>
    s.start(),
  );
  return () => {
    for (const s of scripts) s.cancel();
  };
}
