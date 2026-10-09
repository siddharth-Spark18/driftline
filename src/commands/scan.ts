import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, resolveScanSettings } from "../config/index.ts";
import { renderDigest } from "../digest/terminal.ts";
import { ingestStack } from "../ingestion/stack.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { UsageError } from "../lib/errors.ts";
import { lastScanPath, readOwnPackageJson, resolveTargetRepo } from "../lib/paths.ts";
import { printSuccess } from "../lib/output.ts";
import { buildWorklist, capWorklist } from "../scan/index.ts";
import { createSpinner } from "../ui/spinner.ts";
import { addReportOptions, resolveSaveChoice, saveReport } from "./report-output.ts";

export function registerScanCommand(program: Command): void {
  const scan = program
    .command("scan")
    .description("Scan the target repo for upstream dependency changes and rank a worklist")
    .option("--limit <n>", "max worklist items to show (security items are never dropped); overrides preferences.maxItems")
    .option("--cooldown-days <n>", "flag releases younger than this many days; overrides preferences.cooldownDays");
  addReportOptions(scan)
    .action(
      withErrorHandling(async (outputOpts, command) => {
        const globalOpts = command.optsWithGlobals();
        const repoPath = resolveTargetRepo(globalOpts.repo);
        // Loaded eagerly so a broken config file fails fast.
        const { config } = loadConfig({ repoPath, explicitConfigPath: globalOpts.config });
        const settings = resolveScanSettings(config);
        const maxItems = parseIntegerFlag("--limit", globalOpts.limit, 1) ?? settings.maxItems;
        const cooldownDays = parseIntegerFlag("--cooldown-days", globalOpts.cooldownDays, 0) ?? settings.cooldownDays;

        // Ingestion is local and fast; running it first surfaces a bad repo before any prompt.
        const { packages, warnings } = ingestStack(repoPath);
        for (const warning of warnings) {
          console.error(`driftline: warning: ${warning}`);
        }

        // Asked up front, before the network scan, so the user isn't left waiting on a prompt afterwards.
        const saveChoice = await resolveSaveChoice(globalOpts);
        if (saveChoice === "cancelled") return;

        const spinner = createSpinner(Boolean(process.stderr.isTTY) && !outputOpts.json);
        let ranked;
        try {
          spinner.start("Scanning");
          ranked = await buildWorklist(packages, {
            repoPath,
            cooldownDays,
            githubToken: settings.githubToken,
            onWarning: (message) => spinner.log(`driftline: warning: ${message}`),
            onProgress: (step) => spinner.update(step),
          });
        } finally {
          spinner.stop();
        }
        const { items: worklist, overflow } = capWorklist(ranked, maxItems);
        const scannedAt = new Date().toISOString();
        cacheLastScan(repoPath, worklist, overflow, scannedAt);

        // PER-11: terminal digest is the human-readable path (manual or cron
        // invocation); --json stays the scriptable raw worklist.
        printSuccess(worklist, renderDigest(worklist, { repoLabel: repoPath, overflow }), outputOpts);
        // After the digest so a write failure (exit 1) still leaves the result on screen.
        saveReport(
          saveChoice,
          { scannedAt, repo: repoPath, driftlineVersion: readOwnPackageJson().version, overflow, worklist },
          outputOpts,
        );
      }),
    );
}

function parseIntegerFlag(flag: string, raw: unknown, min: number): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (typeof raw !== "string" || raw.trim() === "" || !Number.isInteger(value) || value < min) {
    throw new UsageError(`${flag} must be an integer >= ${min}, got "${String(raw)}"`);
  }
  return value;
}

function cacheLastScan(repoPath: string, worklist: unknown, overflow: number, scannedAt: string): void {
  const cachePath = lastScanPath(repoPath);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ scannedAt, worklist, overflow }, null, 2));
}
