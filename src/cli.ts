#!/usr/bin/env node
import { Command, CommanderError } from "commander";
import { registerConfigCommand } from "./commands/config.ts";
import { registerDigestCommand } from "./commands/digest.ts";
import { registerScanCommand } from "./commands/scan.ts";
import { CliError, ExitCode } from "./lib/errors.ts";
import { printError } from "./lib/output.ts";
import { readOwnPackageJson } from "./lib/paths.ts";

const pkg = readOwnPackageJson();

const program = new Command();

program
  .name("learning-radar")
  .description("Scan your dependency manifest for upstream changes and turn them into an agent-ready worklist.")
  .version(pkg.version, "-v, --version")
  .option("--json", "output machine-readable JSON instead of human-readable text", false)
  .option("--repo <path>", "path to the target repo (defaults to the current working directory)")
  .option("--config <path>", "path to a config file, bypassing project/global config lookup")
  .exitOverride()
  .configureOutput({
    writeErr: (str) => process.stderr.write(str),
  });

registerScanCommand(program);
registerConfigCommand(program);
registerDigestCommand(program);

async function main(): Promise<void> {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    handleTopLevelError(err);
  }
}

function handleTopLevelError(err: unknown): void {
  if (err instanceof CommanderError) {
    // Commander already prints help/version/usage text itself; these aren't failures.
    if (["commander.helpDisplayed", "commander.version", "commander.help"].includes(err.code)) {
      process.exitCode = ExitCode.Success;
      return;
    }
    const outputOpts = { json: Boolean(program.opts().json) };
    process.exitCode = printError(new CliError(err.message, ExitCode.UsageError), outputOpts);
    return;
  }

  // Anything else is a genuine bug in a command handler that escaped withErrorHandling.
  const outputOpts = { json: Boolean(program.opts().json) };
  process.exitCode = printError(err, outputOpts);
}

main();
