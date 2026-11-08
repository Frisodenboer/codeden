// The real runner, started late: waits CODEDEN_TEST_RUNNER_DELAY_MS before loading the runner
// entry (with the same arguments), like a cold start on a slow or busy machine.
const delay = Number(process.env.CODEDEN_TEST_RUNNER_DELAY_MS ?? "0");
await new Promise((resolve) => setTimeout(resolve, delay));
await import(new URL("../../../runner/src/main.ts", import.meta.url).href);
