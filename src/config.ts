// Environment configuration parsing and validation.

export interface Config {
  apiUrl: string;
  apiToken: string;
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
  const apiUrl = process.env.SIYUAN_API_URL || "http://127.0.0.1:6806";
  const apiToken = process.env.SIYUAN_API_TOKEN || "";

  if (!apiToken) {
    console.error(
      "[siyuan-agent-mcp] FATAL: SIYUAN_API_TOKEN is required. Set it in your environment " +
        "(find it in SiYuan under Settings → About → API token)."
    );
    process.exit(1);
  }

  validateApiUrl(apiUrl);
  return { apiUrl, apiToken };
}
