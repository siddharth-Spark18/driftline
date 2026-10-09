import type { Command } from "commander";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, resolveScanSettings } from "../config/index.ts";
import { renderDigest } from "../digest/terminal.ts";
import { ingestStack } from "../ingestion/stack.ts";
import { withErrorHandling } from "../lib/command-handler.ts";
import { UsageError } from "../lib/errors.ts";
import { lastScanPath, resolveTargetRepo } from "../lib/paths.ts";
import { printSuccess } from "../lib/output.ts";
import { buildWorklist, capWorklist } from "../scan/index.ts";

export function registerScanCommand(program: Command): void {
  program
    .command("scan")
    .description("Scan the target repo for upstream dependency changes and rank a worklist")
    .option("--limit <n>", "max worklist items to show (security items are never dropped); overrides preferences.maxItems")
    .option("--cooldown-days <n>", "flag releases younger than this many days; overrides preferences.cooldownDays")
    .action(
      withErrorHandling(async (outputOpts, command) => {
        const globalOpts = command.optsWithGlobals();
        const repoPath = resolveTargetRepo(globalOpts.repo);
        // Loaded eagerly so a broken config file fails fast.
        const { config } = loadConfig({ repoPath, explicitConfigPath: globalOpts.config });
        const settings = resolveScanSettings(config);
        const maxItems = parseIntegerFlag("--limit", globalOpts.limit, 1) ?? settings.maxItems;
        const cooldownDays = parseIntegerFlag("--cooldown-days", globalOpts.cooldownDays, 0) ?? settings.cooldownDays;

        const { packages, warnings } = ingestStack(repoPath);
        for (const warning of warnings) {
          console.error(`driftline: warning: ${warning}`);
        }

        const ranked = await buildWorklist(packages, {
          repoPath,
          cooldownDays,
          githubToken: settings.githubToken,
          onWarning: (message) => console.error(`driftline: warning: ${message}`),
        });
        const { items: worklist, overflow } = capWorklist(ranked, maxItems);
        cacheLastScan(repoPath, worklist, overflow);

        // PER-11: terminal digest is the human-readable path (manual or cron
        // invocation); --json stays the scriptable raw worklist.
        printSuccess(worklist, renderDigest(worklist, { repoLabel: repoPath, overflow }), outputOpts);
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

function cacheLastScan(repoPath: string, worklist: unknown, overflow: number): void {
  const cachePath = lastScanPath(repoPath);
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, JSON.stringify({ scannedAt: new Date().toISOString(), worklist, overflow }, null, 2));
}
