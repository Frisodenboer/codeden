// A stand-in for the desktop server (`dist/server.js`) whose close never finishes: it reports
// ready, then ignores the app's `shutdown` request. With STUCK_SERVER_MODE=ignore-term it also
// ignores SIGTERM, so only SIGKILL ends it.
process.send({
  type: "ready",
  url: "http://127.0.0.1:1",
  port: 1,
  launchUrl: "http://127.0.0.1:1/",
  version: "0.0.0",
});
process.on("message", () => {});
if (process.env.STUCK_SERVER_MODE === "ignore-term") process.on("SIGTERM", () => {});
setInterval(() => {}, 1_000);
