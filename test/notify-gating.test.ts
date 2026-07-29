import { test } from "vitest";
import assert from "node:assert/strict";

import { shouldNotifySettled } from "../extensions/notify/index.ts";

// The settle-gating decision, pure over its inputs. The wired behavior (focus
// events feeding these inputs through the real runtime) is covered end-to-end in
// notify-e2e.test.ts; these cases pin the truth table exhaustively.

test("shouldNotifySettled: false when disabled", () => {
  assert.equal(shouldNotifySettled({ enabled: false, focusKnown: true, focused: false }), false);
});

test("shouldNotifySettled: true when focus is unknown (can't detect -> notify)", () => {
  assert.equal(shouldNotifySettled({ enabled: true, focusKnown: false, focused: true }), true);
});

test("shouldNotifySettled: false when focused and focus is known (user is watching)", () => {
  assert.equal(shouldNotifySettled({ enabled: true, focusKnown: true, focused: true }), false);
});

test("shouldNotifySettled: true when unfocused and focus is known", () => {
  assert.equal(shouldNotifySettled({ enabled: true, focusKnown: true, focused: false }), true);
});
