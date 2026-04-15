# the-agency

CLI for hiring prompt repositories and resolving prompts from the currently active agency.

## What This Repo Is

`the-agency` is a small Node.js CLI that turns a prompt repository into a local, queryable tool.
You point it at a git repo or a local directory, the CLI records that source in local state, and then you can:

- register one or more prompt repositories as agencies
- mark one agency as the active source
- browse folders and prompt files inside that source
- resolve a specific prompt by path-like selectors
- store local config values alongside agency metadata

The CLI always prints JSON so it can be used interactively or from automation.

## Key Concepts

- `agency`: a registered prompt source, backed by either a git repository URL or a local directory
- `current agency`: the default agency used when you run prompt lookup commands
- `selectors`: positional arguments used to walk folders and prompts inside the active agency
- `local store`: a JSON file under `.agency/` that tracks agencies, config values, and the current selection

## Install

Prerequisites:

- Node.js 20+
- `pnpm`
- `git` available on your `PATH` for cloning and pull-based refreshes

Install dependencies:

```bash
pnpm install
```

## Build And Run

Build the CLI:

```bash
pnpm build
```

Run the installed CLI directly:

```bash
the-agency --help
```

Smoke test the local build:

```bash
pnpm local:test
```

The smoke test rebuilds the project, prints CLI help, and runs `agencies list` against an empty local store.

## Core Commands

Show help:

```bash
the-agency --help
```

List registered agencies:

```bash
the-agency agencies list
```

Register a remote prompt repo and make it active:

```bash
the-agency hire git@github.com:your-org/agency-prompts.git
```

Register a local prompt directory and make it active:

```bash
the-agency hire ../agency-prompts
```

Switch the active agency:

```bash
the-agency agencies use your-org-agency-prompts
```

Browse the root of the active agency:

```bash
the-agency
```

Browse a folder inside the active agency:

```bash
the-agency engineering
```

Resolve a specific prompt from selectors:

```bash
the-agency engineering technical-writer
```

Limit output fields when browsing or resolving:

```bash
the-agency --fields name,description engineering technical-writer
```

List local config values:

```bash
the-agency config list
```

Set and read a local config value:

```bash
the-agency config set default_model gpt-5
the-agency config get default_model
```

## Local Data And Config Behavior

By default, the CLI stores its state in a project-local folder:

```text
./.agency/
```

That directory contains:

- `store.json`: agency registry, current agency, and config values
- `repos/`: cloned copies of remote prompt repositories

You can override the storage location with `AGENCY_HOME`:

```bash
AGENCY_HOME="$HOME/.agency-dev" the-agency agencies list
```

Behavior details:

- hiring a remote repo clones it into `.agency/repos/<derived-key>` if it is not already present
- hiring an already-known remote repo reuses the cached clone
- cached remote repos are refreshed with `git pull --ff-only` at most once every 24 hours
- if refresh fails, the CLI keeps using the existing local clone and returns a warning
- hiring a local directory uses that directory in place; no clone or pull is attempted
- when prompt lookup runs against an empty local store, the CLI automatically registers and activates `https://github.com/nivoset/agency-agents.git` as the default agency

## Prompt Repository Expectations

This CLI expects a prompt repository organized as folders plus Markdown files.

Typical shape:

```text
engineering/
  engineering-technical-writer.md
  engineering-code-reviewer.md
design/
  design-ui-designer.md
```

Prompt files are resolved by selector matching. The resolver supports browsing folders and resolving prompts by file-like names such as `technical-writer`.

The implementation also filters noise at the repo root, including hidden directories, `.git`, `node_modules`, and `.gitignore`d files.

## Common Workflows

Use a prompt repo from git:

```bash
the-agency hire git@github.com:your-org/agency-prompts.git
the-agency engineering
the-agency engineering technical-writer
```

Use a prompt repo from a local checkout while editing prompts:

```bash
the-agency hire ../agency-prompts
the-agency agencies list
the-agency product product-manager
```

Store local defaults for your wrapper scripts:

```bash
the-agency config set model gpt-5
the-agency config set temperature 0.2
the-agency config list
```

## Development

Build:

```bash
pnpm build
```

Run the smoke test:

```bash
pnpm local:test
```

Run the test suite:

```bash
pnpm test
```

`pnpm test` exercises frontmatter parsing, local store behavior, prompt resolution, ambiguity handling, helper utilities, and root-level filtering rules.

## Troubleshooting

`pnpm install` fails with `packages field missing or empty`:

- ensure [`pnpm-workspace.yaml`](./pnpm-workspace.yaml) includes a valid `packages` entry
- this repo expects the workspace file to include `packages: ['.']`

Lookup returns `No agency is active yet`:

- run `the-agency hire <git-repo-or-local-dir>` first
- or switch to an existing agency with `the-agency agencies use <agency-key>`
- if the store is empty, a lookup command will now bootstrap the default agency automatically; this error only appears when agencies already exist but none is active

An agency key is rejected as unknown:

- inspect valid keys with `the-agency agencies list`
- the key is derived from the repo path or repo URL tail and normalized to lowercase kebab-case

A remote repo does not refresh:

- the CLI only attempts `git pull --ff-only` once per 24 hours for cached repos
- if pull fails, the existing local copy is still used and the response includes a warning

You want storage outside the repo:

- set `AGENCY_HOME` to move `.agency` elsewhere

## Output Model

Every command emits JSON. That makes the CLI suitable for shell usage, other CLIs, and agent orchestration layers.

Typical response types include:

- agency registry listings
- active agency selection results
- config set/get/list results
- prompt listings
- resolved prompt payloads
- structured error responses
