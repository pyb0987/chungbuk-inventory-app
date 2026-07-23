import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startAppServer } from "../src/app/server.js";

const dataDir = mkdtempSync(join(tmpdir(), "chungbuk-health-"));
let app;
try {
  app = await startAppServer({ port: 0, dataDir });
  const response = await fetch(`${app.url}/api/state`, {
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new Error(`health endpoint returned HTTP ${response.status}`);
  const state = await response.json();
  if (!state.dashboard || !Array.isArray(state.items) || !Array.isArray(state.auditLog)) {
    throw new Error("health endpoint returned an invalid application state");
  }
  console.log("portable application health check passed");
} finally {
  if (app) await app.close();
  rmSync(dataDir, { recursive: true, force: true });
}
