import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../../extensions/notify/config.ts";

interface Setup {
  readonly globalDir: string;
  readonly projectDir: string;
  readonly cleanup: () => void;
}

function setup(opts: { global?: string; project?: string }): Setup {
  const root = mkdtempSync(join(tmpdir(), "notify-cfg-"));
  const globalDir = join(root, "global");
  const projectDir = join(root, "project");
  mkdirSync(globalDir, { recursive: true });
  mkdirSync(join(projectDir, ".pi"), { recursive: true });
  if (opts.global !== undefined) {
    writeFileSync(join(globalDir, "notify.json"), opts.global);
  }
  if (opts.project !== undefined) {
    writeFileSync(join(projectDir, ".pi", "notify.json"), opts.project);
  }
  return {
    globalDir,
    projectDir,
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("loadConfig: absent config defaults to enabled with no warning", () => {
  const s = setup({});
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.warning, undefined);
  } finally {
    s.cleanup();
  }
});

test("loadConfig: global enabled:false disables notifications", () => {
  const s = setup({ global: '{"enabled": false}' });
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, false);
    assert.equal(cfg.warning, undefined);
  } finally {
    s.cleanup();
  }
});

test("loadConfig: project enabled:true overrides global disabled", () => {
  const s = setup({ global: '{"enabled": false}', project: '{"enabled": true}' });
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, true);
  } finally {
    s.cleanup();
  }
});

test("loadConfig: project enabled:false overrides global enabled", () => {
  const s = setup({ global: '{"enabled": true}', project: '{"enabled": false}' });
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, false);
  } finally {
    s.cleanup();
  }
});

test("loadConfig: malformed global JSON warns and defaults to enabled", () => {
  const s = setup({ global: "{ not json" });
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, true);
    assert.match(cfg.warning ?? "", /failed to parse/);
    assert.match(cfg.warning ?? "", /notify\.json/);
  } finally {
    s.cleanup();
  }
});

test("loadConfig: non-object global JSON warns and defaults to enabled", () => {
  const s = setup({ global: "true" });
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, true);
    assert.match(cfg.warning ?? "", /not a JSON object/);
  } finally {
    s.cleanup();
  }
});

test("loadConfig: malformed project JSON warns but preserves the global setting", () => {
  const s = setup({ global: '{"enabled": true}', project: "{ broken" });
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, true);
    assert.match(cfg.warning ?? "", /failed to parse/);
  } finally {
    s.cleanup();
  }
});

test("loadConfig: explicit enabled:true keeps notifications on", () => {
  const s = setup({ global: '{"enabled": true}' });
  try {
    const cfg = loadConfig({ cwd: s.projectDir, globalDir: s.globalDir, configDirName: ".pi" });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.warning, undefined);
  } finally {
    s.cleanup();
  }
});
