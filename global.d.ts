// Placeholder declaration file. `tsc --noEmit` (no `files`/`include`, so it
// defaults to every `.ts`/`.d.ts` under the repo) needs at least one input;
// while `extensions/` is empty, this file is that input. It is excluded from
// the npm tarball by the `files` allowlist, ignored by oxlint (`**/*.d.ts`),
// and not loaded by pi (it lives outside `extensions/`). Harmless once real
// `.ts` exists.
