/**
 * Notify extension entry point for `@fujuntao/pi-aio`.
 *
 * Delivers cross-platform notifications when pi needs the user - when it settles
 * and is waiting for input (`agent_settled`) and when a tool errors
 * (`tool_result` with `isError`). It auto-selects a native desktop notification
 * when local, or a terminal-protocol notification (OSC 777/9/99) over SSH or
 * when no desktop binary is present - plus a bell and window-title cue. A 10s
 * minimum-duration threshold keeps quick turns quiet.
 *
 * Config: a single `enabled` field in `~/.pi/agent/notify.json` (global) merged
 * with `<cwd>/.pi/notify.json` (project wins). Absent config defaults to
 * enabled.
 *
 * Pure routing/escaping logic lives in `select.ts` and `channels.ts`; this
 * module owns the impure seams (spawning, probing, clock) and the event wiring.
 * `NotifyDeps` lets tests inject fakes for those seams.
 *
 * Inspired by pi's `examples/extensions/notify.ts`, rewritten to fire on
 * `agent_settled` (not `agent_end`, which fires prematurely during auto-retry /
 * auto-compact-and-retry) and to add macOS/Linux native notifications plus
 * min-duration gating.
 */

import { spawn, spawnSync } from "node:child_process";
import { env, platform, stdout } from "node:process";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  type ChannelDeps,
  type ChannelKind,
  type NotifyChannel,
  type NotifyPayload,
  createChannels,
} from "./channels.ts";
import { type LoadedConfig, loadConfig } from "./config.ts";
import { choosePopupKind } from "./select.ts";

/** Minimum agent-run duration (ms) before a "settled" notification fires. */
export const MIN_DURATION_MS = 10_000;

/** Impure seams. Tests inject fakes; production uses the real defaults. */
export interface NotifyDeps {
  readonly now: () => number;
  readonly loadConfig: (cwd: string) => LoadedConfig;
  readonly pickPopupChannel: () => NotifyChannel | undefined;
  readonly ringBell: () => void;
}

// --- Real impure implementations ------------------------------------------

function realSpawnDetached(cmd: string, args: readonly string[]): void {
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {
      // A missing or failing binary must not disturb the session.
    })
    .unref();
}

function realProbe(cmd: string, args: readonly string[]): boolean {
  const result = spawnSync(cmd, args, { stdio: "ignore", timeout: 2_000 });
  return result.error === undefined && typeof result.status === "number";
}

function realChannelDeps(): ChannelDeps {
  return {
    spawn: realSpawnDetached,
    probe: realProbe,
    write: (data) => {
      stdout.write(data);
    },
  };
}

function realPickPopupChannel(): NotifyChannel | undefined {
  const channels = createChannels(realChannelDeps());
  const kind = choosePopupKind({
    env,
    platform,
    isTTY: Boolean(stdout.isTTY),
    desktopAvailable: (k: ChannelKind) => channels[k].available(),
  });
  return kind ? channels[kind] : undefined;
}

function realRingBell(): void {
  if (stdout.isTTY) {
    stdout.write("\x07");
  }
}

function realLoadConfig(cwd: string): LoadedConfig {
  return loadConfig({ cwd, globalDir: getAgentDir(), configDirName: CONFIG_DIR_NAME });
}

function defaultDeps(): NotifyDeps {
  return {
    now: () => Date.now(),
    loadConfig: realLoadConfig,
    pickPopupChannel: realPickPopupChannel,
    ringBell: realRingBell,
  };
}

// --- Pure gating ----------------------------------------------------------

/** Inputs to `shouldNotifySettled`. */
export interface ShouldNotifySettledInput {
  readonly enabled: boolean;
  readonly startedAt: number | undefined;
  readonly now: number;
  readonly minDurationMs: number;
}

/**
 * Whether a "settled" notification should fire. Requires the extension to be
 * enabled, a run to have started, and the run to have lasted at least
 * `minDurationMs`. Pure over its inputs.
 */
export function shouldNotifySettled(input: ShouldNotifySettledInput): boolean {
  if (!input.enabled) return false;
  if (input.startedAt === undefined) return false;
  return input.now - input.startedAt >= input.minDurationMs;
}

// --- Delivery -------------------------------------------------------------

/** Deliver the popup plus the ambient bell and window-title cue. */
function notify(ctx: ExtensionContext, payload: NotifyPayload, deps: NotifyDeps): void {
  const popup = deps.pickPopupChannel();
  if (popup) {
    try {
      popup.send(payload);
    } catch {
      // Fire-and-forget: never let a notification disturb the session.
    }
  }
  deps.ringBell();
  ctx.ui.setTitle(`Pi: ${payload.body}`);
}

// --- Extension factory ----------------------------------------------------

export default function notifyExtension(
  pi: Pick<ExtensionAPI, "on">,
  deps?: Partial<NotifyDeps>,
): void {
  const base = defaultDeps();
  const d: NotifyDeps = {
    now: deps?.now ?? base.now,
    loadConfig: deps?.loadConfig ?? base.loadConfig,
    pickPopupChannel: deps?.pickPopupChannel ?? base.pickPopupChannel,
    ringBell: deps?.ringBell ?? base.ringBell,
  };
  let enabled = true;
  let runStartTime: number | undefined;

  pi.on("session_start", (_event, ctx) => {
    const config = d.loadConfig(ctx.cwd);
    enabled = config.enabled;
    if (config.warning) {
      ctx.ui.notify(config.warning, "warning");
    }
  });

  pi.on("agent_start", () => {
    // Capture the baseline once per agent run. Retries re-fire agent_start
    // but must not reset it, so the duration reflects total user wait time.
    if (runStartTime === undefined) {
      runStartTime = d.now();
    }
  });

  pi.on("agent_settled", (_event, ctx) => {
    const startedAt = runStartTime;
    runStartTime = undefined;
    if (
      !shouldNotifySettled({
        enabled,
        startedAt,
        now: d.now(),
        minDurationMs: MIN_DURATION_MS,
      })
    ) {
      return;
    }
    notify(ctx, { title: "Pi", body: "Finished - waiting for input", urgency: "info" }, d);
  });

  pi.on("tool_result", (event, ctx) => {
    if (!enabled) return;
    if (!event.isError) return;
    notify(ctx, { title: "Pi", body: `Tool "${event.toolName}" failed`, urgency: "error" }, d);
  });
}
