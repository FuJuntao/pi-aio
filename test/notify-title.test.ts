import { expect, test } from "vitest";

import { buildTitle } from "../extensions/notify/index.ts";

// The live terminal title is a pure format over (cwd, activity); the event
// handlers in index.ts set it on `agent_start` (working) and `agent_settled`
// (waiting), decoupled from the popup. This pins the format, the project
// basename, and both activities.

test("buildTitle: working activity on a nested path", () => {
  expect(buildTitle("/home/user/pi-aio", "working")).toBe("Pi · pi-aio · working");
});

test("buildTitle: waiting activity on a nested path", () => {
  expect(buildTitle("/home/user/pi-aio", "waiting")).toBe("Pi · pi-aio · waiting");
});

test("buildTitle: project is the basename only", () => {
  expect(buildTitle("/Users/someone/projects/my-repo", "working")).toBe("Pi · my-repo · working");
});

test("buildTitle: a trailing slash is stripped from the basename", () => {
  expect(buildTitle("/home/user/pi-aio/", "waiting")).toBe("Pi · pi-aio · waiting");
});

test("buildTitle: a bare name has itself as basename", () => {
  expect(buildTitle("just-a-name", "working")).toBe("Pi · just-a-name · working");
});
