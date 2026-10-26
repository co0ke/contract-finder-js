/** How job-site requests are retried when a site fails in a way that may recover. */
export const RetryConstants = Object.freeze({
  /** Retries after the first attempt, so three attempts in all. */
  MaxRetries: 2,

  // Exponential backoff: 500 ms, 1 s, 2 s... each halved-to-full with jitter, never more than the cap.
  BaseDelayMs: 500,
  MaxDelayMs: 8_000,

  /** A Retry-After longer than this isn't worth making the caller wait for: the failure is reported instead. */
  MaxRetryAfterMs: 30_000,

  /** Statuses that mean "try again", as opposed to "fix your request or credentials". */
  RetryableStatuses: Object.freeze([408, 429, 500, 502, 503, 504]),
});
