import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig } from "../config/index.ts";
import { renderDigest } from "../digest/terminal.ts";
import { ingestStack } from "../ingestion/stack.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { lastScanPath, resolveTargetRepo } from "../lib/paths.ts";
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
        cacheLastScan(repoPath, worklist);

        // PER-11: terminal digest is the human-readable path (manual or cron
        // invocation); --json stays the scriptable raw worklist.
        printSuccess(worklist, renderDigest(worklist, { repoLabel: repoPath }), outputOpts);
      }),
    );
}

function cacheLastScan(repoPath: string, worklist: unknown): void {
  const cachePath = lastScanPath(repoPath);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ scannedAt: new Date().toISOString(), worklist }, null, 2));
}
