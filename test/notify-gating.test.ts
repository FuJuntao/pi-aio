import { expect, test } from "vitest";

import { shouldNotifySettled } from "../extensions/notify/index.ts";

// The settle-gating decision, pure over its inputs. The wired behavior (focus
// events feeding these inputs through the real runtime) is covered end-to-end in
// notify-e2e.test.ts; these cases pin the truth table exhaustively.

test("shouldNotifySettled: false when disabled", () => {
  expect(shouldNotifySettled({ enabled: false, focusKnown: true, focused: false })).toBe(false);
});

test("shouldNotifySettled: true when focus is unknown (can't detect -> notify)", () => {
  expect(shouldNotifySettled({ enabled: true, focusKnown: false, focused: true })).toBe(true);
});

test("shouldNotifySettled: false when focused and focus is known (user is watching)", () => {
  expect(shouldNotifySettled({ enabled: true, focusKnown: true, focused: true })).toBe(false);
});

test("shouldNotifySettled: true when unfocused and focus is known", () => {
  expect(shouldNotifySettled({ enabled: true, focusKnown: true, focused: false })).toBe(true);
});
