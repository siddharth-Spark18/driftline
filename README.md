# Learning Radar

A CLI that scans your npm/JS dependency manifest for upstream changes — new
releases, deprecations, advisories — and turns them into a ranked,
agent-ready worklist. See `docs/` / the product brief (Paperclip issue PER-5)
for full product context.

This package currently ships the **project scaffold** (PER-8): the command
framework, config loading, and output/error conventions other tickets build
on. `scan` and `digest` are registered but stubbed out (`NotImplementedError`)
until their respective tickets (PER-9/10/11/12/13) land.

## Usage

```sh
learning-radar scan                 # scan the current directory
learning-radar --repo ../other-repo scan
learning-radar --json scan          # machine-readable output, for scripting

learning-radar config set apiKeys.anthropic sk-ant-...
learning-radar config get preferences.ignorePackages
learning-radar config list
```

## Global flags

- `--json` — emit `{ ok, data }` / `{ ok: false, error }` envelopes on
  stdout/stderr instead of human-readable text.
- `--repo <path>` — target repo to operate on (defaults to `cwd`).
- `--config <path>` — load a single config file verbatim, bypassing the
  project/global lookup below. Intended for CI/scripting.

## Configuration

Two files are merged (project overrides global):

- **Global** — `~/.config/learning-radar/config.json`. Written by
  `config set`; this is where API keys belong, since it's never inside a
  scanned repo and so can't be committed by accident.
- **Project** — `<repo>/.learningradarrc.json`. Optional, meant to be
  checked in for non-secret preferences (e.g. `preferences.ignorePackages`).

`config list` always masks `apiKeys.*` values.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | general/runtime error |
| 2 | usage error (bad flags/arguments) |
| 3 | config error (missing/invalid config file) |

## Development

```sh
npm install
npm run dev -- scan       # run from source via tsx
npm run typecheck
npm test
npm run build              # compiles src/ -> dist/ for npm packaging
```
