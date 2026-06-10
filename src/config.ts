// Environment configuration parsing and validation.

export interface Config {
  apiUrl: string;
  apiToken: string;
  timeoutMs: number;
  maxConcurrency: number;
  retryIndexingMs: number;
  readOnly: boolean;
  enableLegacyAliases: boolean;
  enableSql: boolean;
  enableDangerousTools: boolean;
}

function parseBooleanEnv(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return defaultValue;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(
      `[siyuan-agent-mcp] WARNING: ${name} must be a positive integer; using ${defaultValue}.`
    );
    return defaultValue;
  }
  return parsed;
}

function parseNonNegativeIntEnv(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (!value) return defaultValue;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    console.error(
      `[siyuan-agent-mcp] WARNING: ${name} must be a non-negative integer; using ${defaultValue}.`
    );
    return defaultValue;
  }
  return parsed;
}

function normalizeApiUrl(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Mask credentials embedded in a URL so they never leak into logs. */
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) {
      return url.replace(/\/\/[^@]+@/, "//***:***@");
    }
    return url;
  } catch {
    return "[redacted]";
  }
}

/** Warn (but do not fail) when a remote URL would send the token in cleartext. */
export function validateApiUrl(url: string): void {
  try {
    const parsed = new URL(url);
    if (
      parsed.hostname !== "127.0.0.1" &&
      parsed.hostname !== "localhost" &&
      parsed.protocol !== "https:"
    ) {
      console.error(
        "[siyuan-agent-mcp] WARNING: API_URL is remote but not using HTTPS. Token will be sent in cleartext."
      );
    }
  } catch {
    console.error("[siyuan-agent-mcp] WARNING: API_URL is not a valid URL.");
  }
}

/** Read configuration from the environment. Exits the process if the token is missing. */
export function loadConfig(): Config {
  const apiUrl = normalizeApiUrl(process.env.SIYUAN_API_URL || "http://127.0.0.1:6806");
  const apiToken = process.env.SIYUAN_API_TOKEN || "";
  const timeoutMs = parsePositiveIntEnv("SIYUAN_TIMEOUT_MS", 30_000);
  const maxConcurrency = parsePositiveIntEnv("SIYUAN_MAX_CONCURRENCY", 4);
  const retryIndexingMs = parseNonNegativeIntEnv("SIYUAN_RETRY_INDEXING_MS", 1_500);
  const readOnly = parseBooleanEnv("SIYUAN_READ_ONLY", false);
  const enableLegacyAliases = parseBooleanEnv("SIYUAN_ENABLE_LEGACY_ALIASES", false);
  const enableSql = parseBooleanEnv("SIYUAN_ENABLE_SQL", true);
  const enableDangerousTools = parseBooleanEnv("SIYUAN_ENABLE_DANGEROUS_TOOLS", false);

  if (!apiToken) {
    console.error(
      "[siyuan-agent-mcp] FATAL: SIYUAN_API_TOKEN is required. Set it in your environment " +
        "(find it in SiYuan under Settings → About → API token)."
    );
    process.exit(1);
  }

  validateApiUrl(apiUrl);
  return {
    apiUrl,
    apiToken,
    timeoutMs,
    maxConcurrency,
    retryIndexingMs,
    readOnly,
    enableLegacyAliases,
    enableSql,
    enableDangerousTools,
  };
}
