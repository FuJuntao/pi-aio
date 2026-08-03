# pi-aio

A single, root-level [pi](https://github.com/earendil-works/pi) package -
`@fujuntao/pi-aio` - bundling extensions, skills, prompt templates, and themes
for the pi coding agent. Pi loads `.ts` extensions directly, so this package
ships source (`.ts`/`.md`/`.json`) with no build step.

## Installation

```sh
pi install npm:@fujuntao/pi-aio
```

`pi install` accepts npm, git, and local-path sources and writes to user or
project settings; see `pi install --help` for details.

## What's included

### Extensions

- **[notify](extensions/notify/README.md)** - cross-platform desktop/terminal
  notifications when pi finishes a run and is waiting for input; stays quiet
  while you're focused on the terminal.
- **[subagent](extensions/subagent/README.md)** - delegate work to in-process
  subagents (single or parallel), each in a fresh, config-free context with
  caller-specified system prompts.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, scripts, and
contribution guidelines.
