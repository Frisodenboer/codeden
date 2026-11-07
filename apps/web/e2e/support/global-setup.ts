import { startE2eServer } from "./server";

/**
 * Start one real CodeDen server for the run and hand its URLs to the tests through the
 * environment (workers inherit it). Returns the teardown.
 */
export default async function globalSetup() {
  const server = await startE2eServer();
  process.env.CODEDEN_E2E_URL = server.url;
  process.env.CODEDEN_E2E_LAUNCH_URL = server.launchUrl;
  process.env.CODEDEN_E2E_REPO = server.repo;
  return async () => {
    await server.stop();
  };
}
