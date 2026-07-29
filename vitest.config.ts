import { defineConfig } from "vitest/config";

// Offline, node-env test config for `@fujuntao/pi-aio`. Mirrors pi's essentials:
// node environment, explicit globals, a generous timeout for e2e sessions driven
// by the faux provider, file-per-process isolation (so module-level state like
// pi-ai's faux api-registry can't leak between files), and offline-by-default.
// Tests import { describe, it, expect, test } from "vitest" explicitly so oxlint
// never sees undefined globals despite `globals: true`.
export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One test file per process: keeps pi-ai's global faux api-registry and any
    // process-global state isolated between suites.
    pool: "forks",
    env: { PI_OFFLINE: "1" },
    unstubEnvs: true,
    reporters: process.env["CI"] ? ["github-actions", "default"] : ["default"],
  },
});
