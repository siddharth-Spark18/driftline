import picocolors from "picocolors";

export interface Spinner {
  start(label: string): void;
  update(label: string): void;
  /** Prints a line above the spinner without garbling it (e.g. a warning mid-scan). */
  log(message: string): void;
  stop(): void;
}

const UNICODE_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const ASCII_FRAMES = ["|", "/", "-", "\\"];
const FRAME_MS = 80;

/**
 * Progress spinner on stderr. When `enabled` is false (non-interactive runs)
 * every method is a no-op, except `log`, which falls through to plain stderr.
 */
export function createSpinner(enabled: boolean): Spinner {
  if (!enabled) {
    return { start() {}, update() {}, log: (message) => console.error(message), stop() {} };
  }

  const color = !process.env.NO_COLOR;
  const pc = picocolors.createColors(color);
  const frames = color ? UNICODE_FRAMES : ASCII_FRAMES;
  let label = "";
  let frame = 0;
  let timer: NodeJS.Timeout | undefined;

  const clearLine = () => process.stderr.write("\r\x1b[2K");
  const draw = () => {
    const columns = process.stderr.columns ?? 80;
    // Keep the line within the terminal so redraws never wrap.
    process.stderr.write(`\r\x1b[2K${pc.cyan(frames[frame % frames.length])} ${label.slice(0, columns - 3)}`);
    frame += 1;
  };

  return {
    start(initial) {
      label = initial;
      draw();
      timer = setInterval(draw, FRAME_MS);
      timer.unref();
    },
    update(next) {
      label = next;
    },
    log(message) {
      if (timer) clearLine();
      console.error(message);
      if (timer) draw();
    },
    stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = undefined;
      clearLine();
    },
  };
}
