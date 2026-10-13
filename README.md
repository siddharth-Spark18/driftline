# Driftline

**Which dependency changes actually matter to your repo, and what to tell your coding agent about each one.**

Driftline scans your npm/JS dependencies for upstream changes (new releases, deprecations, security advisories), ranks them, and shows which files in *your* repo are affected. For the items worth acting on, it generates a scoped, ready-to-paste prompt for the coding agent you already use (Claude Code, Cursor, Copilot, ...).

It is not a bot: it never opens PRs, changes your code, or sends your code anywhere. Everything is analyzed locally.

> **Beta.** Driftline is early and the output format may change between releases.

## Install

```sh
npm install -g driftline@beta
# or run without installing
npx driftline@beta scan
```

Requires Node.js 18 or newer.

## Quick start

```sh
cd your-project          # needs a package.json and a lockfile
driftline scan
```

In a terminal, Driftline first asks whether you want the report as terminal output only, or saved as a JSON or Markdown file. Then it scans and prints a digest:

- a summary bar of what it found (security fixes, breaking changes, deprecations, minor updates)
- one card per package with its versions, the reason, how many files use it, and a link to the release or advisory
- a note when a release is very new (see `--cooldown-days`)

Items are ranked: security fixes (by severity), then breaking changes, deprecations and minor updates.

## What you get

For each security fix, breaking change and deprecation, Driftline builds a prompt for your agent. It contains the upgrade task, the version change, links to the release notes or advisory, the files in your repo that use the package (with a confidence level), a boundary ("only do this upgrade, don't refactor unrelated code"), and the checks to run, using the `test`, `typecheck` and `build` scripts from your own `package.json`.

Prompts contain links, not text copied from release notes or advisories. Prompts are included in the JSON and Markdown reports.

## Saving reports

Interactively, use the menu. In scripts, CI or cron, use flags (no menu appears when there is no terminal):

```sh
driftline scan --format markdown                 # saved in the current directory
driftline scan --format json --output ./reports  # saved in ./reports (created if missing)
```

Files are named like `driftline-2026-10-09T14-30-05.md` and are never overwritten. `driftline digest` re-renders the most recent scan and supports the same options.

## Commands

| Command | What it does |
|---|---|
| `driftline scan` | Scan the repo and print the ranked digest |
| `driftline digest` | Re-render the last scan without hitting the network |
| `driftline config <get\|set\|list>` | Read or change configuration |

### Flags

Global:

- `--json`: print `{ ok, data }` / `{ ok: false, error }` envelopes instead of human-readable text.
- `--repo <path>`: the project to scan (defaults to the current directory).
- `--config <path>`: use one config file and skip the project/global lookup.

`scan`:

- `--limit <n>`: show at most `n` items. Security items are never dropped; extra items are summarized as "+N more".
- `--cooldown-days <n>`: flag releases younger than `n` days (default 3; `0` turns the flag off).

`scan` and `digest`:

- `--format <json|markdown>`: save a report file.
- `--output <dir>`: directory for the report (requires `--format`; defaults to the current directory).

Set `NO_COLOR=1` to turn colors off. The layout stays the same.

## Configuration

Two files are merged, with the project file taking priority:

- **Global**: `~/.config/driftline/config.json`, written by `driftline config set`. API keys belong here since it is outside any scanned repo.
- **Project**: `<repo>/.driftlinerc.json`, optional, for non-secret preferences you may want to commit.

| Key | Meaning | Default |
|---|---|---|
| `preferences.maxItems` | Maximum items shown by `scan` | `10` |
| `preferences.cooldownDays` | Flag releases younger than this many days | `3` |
| `apiKeys.github` | GitHub token for release-note lookups (the `GITHUB_TOKEN` environment variable takes precedence) | none |

A GitHub token is optional. Without one, GitHub allows about 60 requests per hour; if you hit that limit Driftline skips release notes for the rest of the run and warns you instead of failing.

```sh
driftline config set preferences.maxItems 5
driftline config list     # API key values are masked
```

## Privacy

- Your code is analyzed on your machine. Driftline reads your manifest, lockfile and source files locally to find where packages are used.
- Network requests go to the npm registry, the GitHub Releases API and the OSV vulnerability database, and contain package names and versions only.
- Reports list file paths from your repo. Keep that in mind before sharing one.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 1 | general/runtime error |
| 2 | usage error (bad flags/arguments) |
| 3 | config error (missing/invalid config file) |

## Limitations

- npm/JS only; Python, Go and other ecosystems are not supported.
- A lockfile is needed to know the installed versions. Packages without a resolved version are skipped.
- "Affected files" detection is pattern-based, not a full code analysis, so each result carries a confidence level.

## Development

```sh
npm install
npm run dev -- scan       # run from source via tsx
npm run typecheck
npm test
npm run build             # compile src/ to dist/
```

## License

MIT
