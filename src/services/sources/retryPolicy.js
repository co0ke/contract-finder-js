import { setTimeout as delay } from 'node:timers/promises';
import { RetryConstants } from '../../constants/retryConstants.js';
import { nullLogger } from '../logger.js';
import { isTimeoutError, isUnreachableError } from './httpClient.js';

/**
 * Retries a request that failed in a way that may recover: no response, a timeout, or a 408/429/5xx.
 * Waits exponentially longer between attempts (with jitter, so parallel keyword searches don't retry in
 * step), or as long as the site's Retry-After header asks. Anything else is returned or rethrown at once.
 *
 * Equivalent to a resilience handler on the .NET HttpClient: attached in composition, not in the sources.
 */
export class RetryPolicy {
  #maxRetries;
  #baseDelayMs;
  #maxDelayMs;
  #maxRetryAfterMs;
  #retryableStatuses;
  #logger;
  #sleep;
  #random;
  #now;

  /**
   * @param {object} [options]
   * @param {number} [options.maxRetries]
   * @param {number} [options.baseDelayMs]
   * @param {number} [options.maxDelayMs]
   * @param {number} [options.maxRetryAfterMs]
   * @param {ReadonlyArray<number>} [options.retryableStatuses]
   * @param {import('../logger.js').Logger} [options.logger] Each retry is logged as a warning.
   * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [options.sleep] Injectable so tests don't wait.
   * @param {() => number} [options.random] Jitter source, 0 ≤ n < 1.
   * @param {() => number} [options.now] For Retry-After dates.
   */
  constructor({
    maxRetries = RetryConstants.MaxRetries,
    baseDelayMs = RetryConstants.BaseDelayMs,
    maxDelayMs = RetryConstants.MaxDelayMs,
    maxRetryAfterMs = RetryConstants.MaxRetryAfterMs,
    retryableStatuses = RetryConstants.RetryableStatuses,
    logger = nullLogger,
    sleep = (ms, signal) => delay(ms, undefined, { signal }),
    random = Math.random,
    now = Date.now,
  } = {}) {
    this.#maxRetries = maxRetries;
    this.#baseDelayMs = baseDelayMs;
    this.#maxDelayMs = maxDelayMs;
    this.#maxRetryAfterMs = maxRetryAfterMs;
    this.#retryableStatuses = new Set(retryableStatuses);
    this.#logger = logger;
    this.#sleep = sleep;
    this.#random = random;
    this.#now = now;
  }

  get maxRetries() {
    return this.#maxRetries;
  }

  /** @param {number} status */
  isRetryableStatus(status) {
    return this.#retryableStatuses.has(status);
  }

  /** No response or a timeout; not the caller cancelling, and not a bug. */
  static isRetryableError(error) {
    return isTimeoutError(error) || isUnreachableError(error);
  }

  /**
   * How long to wait before retry number `retry` (1-based): base × 2^(retry−1), capped, then jittered to
   * somewhere between half and all of that ("equal jitter").
   * @param {number} retry
   */
  backoffMs(retry) {
    const exponential = Math.min(this.#maxDelayMs, this.#baseDelayMs * 2 ** (retry - 1));
    return Math.round(exponential / 2 + this.#random() * (exponential / 2));
  }

  /**
   * Runs `attempt` until it returns a response that isn't retryable, throws an error that isn't, or the
   * retries run out; then returns or throws whatever the last attempt did.
   * @param {(attempt: number) => Promise<Response>} attempt Called with 0 for the first try, 1 for the first retry...
   * @param {{ description?: string, signal?: AbortSignal }} [options] `signal` stops a wait when the caller cancels.
   * @returns {Promise<Response>}
   */
  async execute(attempt, { description = 'request', signal } = {}) {
    for (let retry = 0; ; retry++) {
      let response;
      try {
        response = await attempt(retry);
      } catch (error) {
        if (retry === this.#maxRetries || !RetryPolicy.isRetryableError(error)) {
          throw error;
        }
        await this.#wait(this.backoffMs(retry + 1), retry + 1, description, isTimeoutError(error) ? 'timed out' : 'got no response', signal);
        continue;
      }

      if (retry === this.#maxRetries || !this.isRetryableStatus(response.status)) {
        return response;
      }
      const retryAfter = this.#retryAfterMs(response);
      if (retryAfter === null) {
        // The site asked for a longer pause than the caller should wait for: report the failure instead.
        return response;
      }
      const waitMs = retryAfter ?? this.backoffMs(retry + 1);
      await discard(response);
      await this.#wait(waitMs, retry + 1, description, `returned ${response.status}`, signal);
    }
  }

  async #wait(ms, retry, description, reason, signal) {
    this.#logger.warn(`${description} ${reason}; retry ${retry} of ${this.#maxRetries} in ${ms} ms.`);
    await this.#sleep(ms, signal);
  }

  /**
   * The Retry-After header as a wait in ms: undefined when absent or unreadable (use backoff), null when
   * longer than the policy allows (give up).
   * @param {Response} response
   */
  #retryAfterMs(response) {
    const ms = retryAfterMs(response.headers.get('Retry-After'), this.#now);
    if (ms === undefined) {
      return undefined;
    }
    return ms > this.#maxRetryAfterMs ? null : ms;
  }
}

/**
 * Parses a Retry-After value: delay-seconds or an HTTP-date. Undefined when missing or unreadable.
 * @param {string | null} value
 * @param {() => number} [now]
 * @returns {number | undefined}
 */
export function retryAfterMs(value, now = Date.now) {
  if (value === null || value.trim() === '') {
    return undefined;
  }
  if (/^\d+$/.test(value.trim())) {
    return Number(value) * 1000;
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now());
}

// A retried response is never read; releasing its body frees the connection.
async function discard(response) {
  try {
    await response.body?.cancel();
  } catch {
    // Already consumed or closed: nothing to release.
  }
}
