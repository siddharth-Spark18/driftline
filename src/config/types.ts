// Config shape shared by the scaffold and later tickets. Keys are additive:
// scan/engine/digest tickets should extend `preferences`, and vendor-key
// tickets (Claude API, email) should extend `apiKeys`, rather than inventing
// a parallel config file.

export interface DriftlineConfig {
  apiKeys?: {
    /** Anthropic API key, used by changelog summarization + prompt generation (PER-12). */
    anthropic?: string;
    /** Transactional email provider key, used by email digest delivery (PER-13). */
    email?: string;
    /** GitHub token for release-note lookups (optional; the GITHUB_TOKEN env var takes precedence). */
    github?: string;
  };
  preferences?: {
    /** Package names to exclude from scan results entirely. */
    ignorePackages?: string[];
    /** Max worklist items shown by `scan`; security items are never dropped. Default 10. */
    maxItems?: number;
    /** Flag releases younger than this many days (flag only). Default 3; 0 disables. */
    cooldownDays?: number;
    digest?: {
      /** Cron-style schedule string for scheduled digest runs. */
      schedule?: string;
    };
  };
}

/** Dot-separated paths under DriftlineConfig that `config get/set` may read, for validation. */
export const CONFIG_KEY_PREFIXES = ["apiKeys", "preferences"] as const;

export const DEFAULT_MAX_ITEMS = 10;
export const DEFAULT_COOLDOWN_DAYS = 3;
