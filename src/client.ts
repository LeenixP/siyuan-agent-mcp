// SiYuanClient: HTTP wrapper with auth, error handling, and transaction flushing.

import type { Config } from "./config.js";
import { sanitizeUrl } from "./config.js";
import type { SiYuanResponse } from "./types.js";

export class SiYuanClient {
  private readonly apiUrl: string;
  private readonly apiToken: string;

  constructor(config: Config) {
    this.apiUrl = config.apiUrl;
    this.apiToken = config.apiToken;
  }

  /**
   * POST to a SiYuan endpoint and unwrap the standard {code,msg,data} envelope.
   * Throws an actionable Error on network failure, non-JSON, or non-zero code.
   */
  async request<T = unknown>(
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiToken) {
      headers["Authorization"] = `Token ${this.apiToken}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      throw new Error(
        `Failed to reach SiYuan at ${sanitizeUrl(this.apiUrl)} [${endpoint}]: ${String(err)}. ` +
          `Is SiYuan running with the kernel API enabled?`
      );
    }

    let json: SiYuanResponse<T>;
    try {
      json = (await response.json()) as SiYuanResponse<T>;
    } catch {
      throw new Error(
        `SiYuan returned a non-JSON response [${endpoint}] (HTTP ${response.status}). ` +
          `Check that SIYUAN_API_URL points at the kernel API.`
      );
    }

    if (json.code !== 0) {
      throw new Error(
        `SiYuan API error [${endpoint}]: code=${json.code} msg="${json.msg}"`
      );
    }

    return json.data;
  }

  /**
   * Flush SiYuan's async SQL write transaction so freshly written blocks are
   * immediately queryable. Best-effort: a flush failure must not fail the write.
   */
  async flushTransaction(): Promise<void> {
    try {
      await this.request("/api/sqlite/flushTransaction");
    } catch (err) {
      console.error("[siyuan-agent-mcp] flushTransaction failed (non-fatal):", err);
    }
  }
}
