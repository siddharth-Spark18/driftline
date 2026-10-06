import type { Command } from "commander";
import { getByPath, loadConfig, redactSecrets, writeGlobalConfigValue } from "../config/index.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { CliError, ExitCode } from "../lib/errors.ts";
import { printSuccess } from "../lib/output.ts";
import { resolveTargetRepo } from "../lib/paths.ts";

export function registerConfigCommand(program: Command): void {
  const config = program
    .command("config")
    .description("Read or update Learning Radar configuration (API keys, preferences)");

  config
    .command("list")
    .description("Print the resolved config and which files it was loaded from")
    .action(
      withErrorHandling(async (outputOpts, command) => {
        const globalOpts = command.optsWithGlobals();
        const repoPath = resolveTargetRepo(globalOpts.repo);
        const { config: resolved, sources } = loadConfig({ repoPath, explicitConfigPath: globalOpts.config });
        const safe = redactSecrets(resolved);

        const summary =
          sources.length === 0
            ? "No config files found (using defaults). Set values with `config set <key> <value>`."
            : `Loaded from:\n${sources.map((s) => `  - ${s}`).join("\n")}\n\n${JSON.stringify(safe, null, 2)}`;

        printSuccess({ config: safe, sources }, summary, outputOpts);
      }),
    );

  config
    .command("get <key>")
    .description("Print a single config value (dot path, e.g. preferences.ignorePackages)")
    .action(
      withErrorHandling(async (outputOpts, command, key: string) => {
        const globalOpts = command.optsWithGlobals();
        const repoPath = resolveTargetRepo(globalOpts.repo);
        const { config: resolved } = loadConfig({ repoPath, explicitConfigPath: globalOpts.config });
        const safe = redactSecrets(resolved) as Record<string, unknown>;
        const value = getByPath(safe, key);

        if (value === undefined) {
          throw new CliError(`No config value set for "${key}"`, ExitCode.GeneralError);
        }

        printSuccess({ key, value }, typeof value === "string" ? value : JSON.stringify(value), outputOpts);
      }),
    );

  config
    .command("set <key> <value>")
    .description("Set a value in the global config file (~/.config/learning-radar/config.json)")
    .action(
      withErrorHandling(async (outputOpts, _command, key: string, value: string) => {
        const path = writeGlobalConfigValue(key, value);
        printSuccess({ key, value, path }, `Set ${key} in ${path}`, outputOpts);
      }),
    );
}
