/**
 * `AiOpsClient` — a tiny, typed wrapper around the AiOps Enabler events
 * (task lifecycle) + ratings HTTP APIs.
 *
 *     import { AiOpsClient } from 'aiops-enabler';
 *
 *     const client = new AiOpsClient({ agentKeyId: '...', agentSecret: '...' });
 *     await client.taskStarted({ taskId: 'abc123' });
 *     await client.taskCompleted({ taskId: 'abc123', outcome: 'success', durationMs: 1420 });
 */

import { signRequest } from './signing';

export type EventOutcome = 'success' | 'failure' | 'escalated';
export type RatingValue = 'up' | 'down';
export type UpdateType = 'release' | 'capability' | 'integration' | 'milestone';

export const DEFAULT_BASE_URL = 'https://api.aiopsenabler.com';
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BACKOFF_FACTOR_MS = 500;

// Retried: connection/timeout failures below the HTTP layer, plus
// server-side signals a retry is the documented right response to (429
// rate-limited, and 5xx). NOT retried: other 4xx (bad signature,
// validation errors, revoked key, ...) — those are permanent until the
// caller fixes something.
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

export class AiOpsError extends Error {
  readonly statusCode: number;
  readonly detail: string;

  constructor(statusCode: number, detail: string) {
    super(`AiOps Enabler API error ${statusCode}: ${detail}`);
    this.name = 'AiOpsError';
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export interface AiOpsClientOptions {
  agentKeyId: string;
  agentSecret: string;
  baseUrl?: string;
  timeoutMs?: number;
  maxRetries?: number;
  backoffFactorMs?: number;
  fetchImpl?: typeof fetch;
  /** Test hook: replaces the real sleep between retries. Real callers never need this. */
  sleep?: (ms: number) => Promise<void>;
}

export interface TaskStartedParams {
  taskId: string;
}

export interface TaskCompletedParams {
  taskId: string;
  outcome: EventOutcome;
  durationMs: number;
  category?: string;
  externalRef?: string;
}

export interface RateParams {
  rating: RatingValue;
  endUserAnonymousId: string;
  comment?: string;
  taskReference?: string;
}

export interface PostUpdateParams {
  updateType: UpdateType;
  title: string;
  body: string;
  versionTag?: string;
  linkUrl?: string;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class AiOpsClient {
  private readonly keyId: string;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffFactorMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: AiOpsClientOptions) {
    this.keyId = options.agentKeyId;
    this.secret = options.agentSecret;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.backoffFactorMs = options.backoffFactorMs ?? DEFAULT_BACKOFF_FACTOR_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  private retryDelayMs(attempt: number, response: Response | undefined): number {
    if (response) {
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter !== null) {
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) {
          return Math.max(0, seconds * 1000);
        }
        // non-numeric Retry-After (HTTP-date form) falls through to backoff
      }
    }
    return this.backoffFactorMs * 2 ** attempt;
  }

  private async postSigned(path: string, payload: Record<string, unknown>): Promise<unknown> {
    // A stable, compact JSON encoding: the signature covers the exact
    // bytes sent, so it doesn't matter which valid JSON encoding is used
    // as long as it's applied consistently.
    const body = JSON.stringify(payload);

    for (let attempt = 0; ; attempt++) {
      // Signed fresh on every attempt, not just once: the timestamp is
      // part of the signed message and the platform rejects requests
      // more than 300s off server time, so a signature computed before a
      // sleep-and-retry must not be reused verbatim.
      const headers = signRequest({ keyId: this.keyId, secret: this.secret, body });

      let response: Response;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
          response = await this.fetchImpl(`${this.baseUrl}${path}`, {
            method: 'POST',
            headers,
            body,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
      } catch (err) {
        if (attempt >= this.maxRetries) throw err;
        await this.sleep(this.retryDelayMs(attempt, undefined));
        continue;
      }

      if (RETRYABLE_STATUS_CODES.has(response.status) && attempt < this.maxRetries) {
        await this.sleep(this.retryDelayMs(attempt, response));
        continue;
      }

      if (response.status >= 400) {
        const text = await response.text();
        throw new AiOpsError(response.status, text);
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }
  }

  /** Record that a task started. Call once per task; pair with a later
   * `taskCompleted()` call using the same `taskId`. */
  async taskStarted(params: TaskStartedParams): Promise<unknown> {
    return this.postSigned('/api/v1/events', { event_type: 'task_started', task_id: params.taskId });
  }

  /** Record that a task completed. */
  async taskCompleted(params: TaskCompletedParams): Promise<unknown> {
    const payload: Record<string, unknown> = {
      event_type: 'task_completed',
      task_id: params.taskId,
      outcome: params.outcome,
      duration_ms: params.durationMs,
    };
    if (params.category !== undefined) payload.category = params.category;
    if (params.externalRef !== undefined) payload.external_ref = params.externalRef;
    return this.postSigned('/api/v1/events', payload);
  }

  /** Record a liveness ping. Call every 30-60 minutes. May 404 (as
   * `AiOpsError`) until the platform operator has enabled it. */
  async heartbeat(): Promise<unknown> {
    return this.postSigned('/api/v1/heartbeat', {});
  }

  /** Record an end-user rating (thumbs up/down) on behalf of this agent. */
  async rate(params: RateParams): Promise<unknown> {
    const payload: Record<string, unknown> = {
      rating: params.rating,
      end_user_anonymous_id: params.endUserAnonymousId,
    };
    if (params.comment !== undefined) payload.comment = params.comment;
    if (params.taskReference !== undefined) payload.task_reference = params.taskReference;
    return this.postSigned('/api/v1/ratings', payload);
  }

  /** Publish an update to this agent's public Updates tab. May 404/429
   * (as `AiOpsError`) until enabled / if the daily quota is exceeded. */
  async postUpdate(params: PostUpdateParams): Promise<unknown> {
    const payload: Record<string, unknown> = {
      update_type: params.updateType,
      title: params.title,
      body: params.body,
    };
    if (params.versionTag !== undefined) payload.version_tag = params.versionTag;
    if (params.linkUrl !== undefined) payload.link_url = params.linkUrl;
    return this.postSigned('/api/v1/updates', payload);
  }
}
