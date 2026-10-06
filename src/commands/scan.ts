import type { Command } from "commander";
import { loadConfig } from "../config/index.ts";
import { ingestStack } from "../ingestion/stack.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { resolveTargetRepo } from "../lib/paths.ts";
import { printSuccess } from "../lib/output.ts";
import { buildWorklist } from "../scan/index.ts";

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan the target repo for upstream dependency changes and rank a worklist")
    .action(
      withErrorHandling(async (outputOpts, command) => {
        const globalOpts = command.optsWithGlobals();
        const repoPath = resolveTargetRepo(globalOpts.repo);
        // Loaded eagerly so a broken config file fails fast, even though the
        // scan engine (PER-10) is what actually consumes it.
        loadConfig({ repoPath, explicitConfigPath: globalOpts.config });

        const { packages, warnings } = ingestStack(repoPath);
        for (const warning of warnings) {
          console.error(`learning-radar: warning: ${warning}`);
        }

        const worklist = await buildWorklist(packages);

        // Digest rendering (PER-11) lands as a follow-up; for now --json is the
        // scriptable path and the human path is a plain summary line.
        printSuccess(
          worklist,
          worklist.length === 0
            ? "No upstream changes found."
            : `Found ${worklist.length} package(s) with upstream changes. Run with --json for the full ranked worklist.`,
          outputOpts,
        );
      }),
    );
}
