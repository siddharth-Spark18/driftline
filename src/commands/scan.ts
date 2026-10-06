import type { Command } from "commander";
import { loadConfig } from "../config/index.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { NotImplementedError } from "../lib/errors.ts";
import { resolveTargetRepo } from "../lib/paths.ts";

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan the target repo for upstream dependency changes and rank a worklist")
    .action(
      withErrorHandling(async (_outputOpts, command) => {
        const globalOpts = command.optsWithGlobals();
        const repoPath = resolveTargetRepo(globalOpts.repo);
        // Loaded eagerly so a broken config file fails fast, even though the
        // scan engine (PER-10) is what actually consumes it.
        loadConfig({ repoPath, explicitConfigPath: globalOpts.config });

        throw new NotImplementedError(
          "scan is not yet implemented — this is the CLI scaffold (PER-8). " +
            "Stack ingestion (PER-9), the scan engine (PER-10), and digest output (PER-11) land in follow-up tickets.",
        );
      }),
    );
}
