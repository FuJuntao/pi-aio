/**
 * Config loading for the notify extension.
 *
 * Reads `enabled` from two JSON files: a global one (`<globalDir>/notify.json`,
 * normally `~/.pi/agent/notify.json`) and a project-local one
 * (`<cwd>/<configDirName>/notify.json`, normally `<cwd>/.pi/notify.json`).
 * Project-local overrides global; absent config defaults to enabled. A
 * malformed or non-object file falls back to enabled and surfaces a warning
 * string the caller can show.
 *
 * Paths are passed in explicitly so this module stays decoupled from pi's
 * `getAgentDir`/`CONFIG_DIR_NAME` and is testable with temp directories.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

interface NotifyConfig {
  readonly enabled?: unknown;
}

export interface LoadedConfig {
  readonly enabled: boolean;
  readonly warning: string | undefined;
}

export interface LoadConfigOptions {
  /** Project working directory. */
  readonly cwd: string;
  /** Global agent config directory (e.g. `~/.pi/agent`). */
  readonly globalDir: string;
  /** Project-local config directory name (e.g. `.pi`). */
  readonly configDirName: string;
}

/**
 * Load `enabled` from config files. Project-local overrides global; absent
 * config defaults to enabled. A malformed or non-object file falls back to
 * enabled and surfaces a warning.
 */
export function loadConfig(opts: LoadConfigOptions): LoadedConfig {
  const { cwd, globalDir, configDirName } = opts;
  const globalPath = join(globalDir, "notify.json");
  const projectPath = join(cwd, configDirName, "notify.json");
  let merged: NotifyConfig = {};
  let warning: string | undefined;

  for (const path of [globalPath, projectPath]) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
      if (parsed !== null && typeof parsed === "object") {
        merged = { ...merged, ...(parsed as NotifyConfig) };
      } else {
        warning = `notify: ${path} is not a JSON object; ignoring it`;
      }
    } catch (error) {
      warning = `notify: failed to parse ${path}: ${(error as Error).message}`;
    }
  }

  return { enabled: merged.enabled !== false, warning };
}
