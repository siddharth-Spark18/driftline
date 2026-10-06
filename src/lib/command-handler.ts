import type { Command } from "commander";
import { printError, type OutputOptions } from "./output.ts";

type ActionHandler<Args extends unknown[]> = (outputOpts: OutputOptions, command: Command, ...args: Args) => Promise<void> | void;

/**
 * Wraps a command's action so every command gets the same --json-aware error
 * reporting and exit-code conventions without repeating try/catch per command.
 * Commander action callbacks receive (...declaredArgs, options, command); this
 * reorders to put resolved output options first since every handler needs them.
 */
export function withErrorHandling<Args extends unknown[]>(handler: ActionHandler<Args>) {
  return async (...rawArgs: unknown[]): Promise<void> => {
    const command = rawArgs[rawArgs.length - 1] as Command;
    const args = rawArgs.slice(0, -2) as Args; // drop commander's trailing (options, command)
    const globalOpts = command.optsWithGlobals();
    const outputOpts: OutputOptions = { json: Boolean(globalOpts.json) };

    try {
      await handler(outputOpts, command, ...args);
    } catch (err) {
      process.exitCode = printError(err, outputOpts);
    }
  };
}
