// SiYuanClient: HTTP wrapper with auth, error handling, and transaction flushing.

import type { Config } from "./config.js";
import { sanitizeUrl } from "./config.js";
import type { SiYuanResponse } from "./types.js";

export class SiYuanClient {
  private readonly apiUrl: string;
  private readonly apiToken: string;
  private readonly timeoutMs: number;
  private readonly maxConcurrency: number;
  private readonly retryIndexingMs: number;
  private activeRequests = 0;
  private readonly pendingRequests: Array<() => void> = [];

  constructor(config: Config) {
    this.apiUrl = config.apiUrl;
    this.apiToken = config.apiToken;
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.maxConcurrency = Math.max(1, config.maxConcurrency ?? 4);
    this.retryIndexingMs = Math.max(0, config.retryIndexingMs ?? 1_500);
  }

  /**
   * POST to a SiYuan endpoint and unwrap the standard {code,msg,data} envelope.
   * Throws an actionable Error on network failure, non-JSON, or non-zero code.
   */
  async request<T = unknown>(
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    return this.withConcurrency(() => this.requestWithRetry<T>(endpoint, body));
  }

  private async withConcurrency<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeRequests >= this.maxConcurrency) {
      await new Promise<void>((resolve) => {
        this.pendingRequests.push(resolve);
      });
    }

    this.activeRequests += 1;
    try {
      return await operation();
    } finally {
      this.activeRequests -= 1;
      const next = this.pendingRequests.shift();
      if (next) next();
    }
  }

  private async requestWithRetry<T = unknown>(
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    let json = await this.requestOnce<T>(endpoint, body);
    if (json.code === 3 && this.retryIndexingMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.retryIndexingMs));
      json = await this.requestOnce<T>(endpoint, body);
    }

    if (json.code !== 0) {
      const hint =
        json.code === 3
          ? " The SiYuan index may still be building; retry after it finishes or increase SIYUAN_RETRY_INDEXING_MS."
          : "";
      throw new Error(
        `SiYuan API error [${endpoint}]: code=${json.code} msg="${json.msg || "(empty)"}".${hint}`
      );
    }

    return json.data;
  }

  private async requestOnce<T = unknown>(
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<SiYuanResponse<T>> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiToken) {
      headers["Authorization"] = `Token ${this.apiToken}`;
    }

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      response = await fetch(`${this.apiUrl}${endpoint}`, {
        method: "POST",
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "AbortError"
          ? `request timed out after ${this.timeoutMs}ms`
          : String(err);
      throw new Error(
        `Failed to reach SiYuan at ${sanitizeUrl(this.apiUrl)} [${endpoint}]: ${reason}. ` +
          `Is SiYuan running with the kernel API enabled?`
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.ok === false) {
      throw new Error(
        `SiYuan HTTP error [${endpoint}]: ${response.status} ${response.statusText}. ` +
          `Check SIYUAN_API_URL, token permissions, and whether the kernel is available.`
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

    return json;
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
