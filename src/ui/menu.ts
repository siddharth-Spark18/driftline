import { input, select } from "@inquirer/prompts";
import type { ReportFormat } from "../report/types.ts";

export interface SaveChoice {
  format: ReportFormat;
  /** Directory to write into; relative paths resolve against the current directory. */
  dir: string;
}

/** `null` means "Terminal only"; `"cancelled"` means the user aborted the menu. */
export type MenuResult = SaveChoice | null | "cancelled";

// Prompts render on stderr so stdout stays clean for piping.
const promptContext = { input: process.stdin, output: process.stderr };

/** Up-front output menu, shown before the scan runs. Only call this in a real terminal. */
export async function promptOutputChoice(): Promise<MenuResult> {
  try {
    const output = await select<"terminal" | ReportFormat>(
      {
        message: "How do you want your report?",
        choices: [
          { name: "Terminal only", value: "terminal" },
          { name: "Save as JSON", value: "json" },
          { name: "Save as Markdown", value: "markdown" },
        ],
      },
      promptContext,
    );
    if (output === "terminal") return null;

    const location = await select<"cwd" | "custom">(
      {
        message: "Where should it be saved?",
        choices: [
          { name: "Current directory", value: "cwd" },
          { name: "Specify a path", value: "custom" },
        ],
      },
      promptContext,
    );
    if (location === "cwd") return { format: output, dir: process.cwd() };

    const dir = await input(
      { message: "Directory to save into (created if missing):", validate: (value) => value.trim() !== "" || "Enter a directory path." },
      promptContext,
    );
    return { format: output, dir: dir.trim() };
  } catch (err) {
    // Ctrl+C in a prompt rejects with ExitPromptError.
    if (err instanceof Error && err.name === "ExitPromptError") return "cancelled";
    throw err;
  }
}
