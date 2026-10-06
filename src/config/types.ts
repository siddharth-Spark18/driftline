// Config shape shared by the scaffold and later tickets. Keys are additive:
// scan/engine/digest tickets should extend `preferences`, and vendor-key
// tickets (Claude API, email) should extend `apiKeys`, rather than inventing
// a parallel config file.

export interface LearningRadarConfig {
  apiKeys?: {
    /** Anthropic API key, used by changelog summarization + prompt generation (PER-12). */
    anthropic?: string;
    /** Transactional email provider key, used by email digest delivery (PER-13). */
    email?: string;
  };
  preferences?: {
    /** Package names to exclude from scan results entirely. */
    ignorePackages?: string[];
    digest?: {
      /** Cron-style schedule string for scheduled digest runs. */
      schedule?: string;
    };
  };
}

/** Dot-separated paths under LearningRadarConfig that `config get/set` may read, for validation. */
export const CONFIG_KEY_PREFIXES = ["apiKeys", "preferences"] as const;
