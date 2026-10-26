import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RetryConstants } from '../../../src/constants/retryConstants.js';
import { RetryPolicy, retryAfterMs } from '../../../src/services/sources/retryPolicy.js';
import { connectionRefused, timedOut } from '../../testDoubles.js';

/** A policy that records its waits instead of sleeping, with jitter pinned to the top of the range. */
function createPolicy(options = {}) {
  const waits = [];
  const warnings = [];
  const policy = new RetryPolicy({
    sleep: async (ms) => { waits.push(ms); },
    random: () => 0.999999,
    logger: { info() {}, warn: (line) => warnings.push(line), error() {} },
    ...options,
  });
  return { policy, waits, warnings };
}

const response = (status, headers = {}) => new Response(`status ${status}`, { status, headers });

/** An attempt that works through a script of responses/errors, recording how often it was called. */
function scripted(...outcomes) {
  const calls = [];
  const attempt = async (retry) => {
    calls.push(retry);
    const outcome = outcomes.shift();
    if (outcome instanceof Error) {
      throw outcome;
    }
    return outcome;
  };
  attempt.calls = calls;
  return attempt;
}

describe('RetryPolicy', () => {
  it('Execute_FirstAttemptSucceeds_ReturnsItWithoutWaiting', async () => {
    const { policy, waits } = createPolicy();
    const attempt = scripted(response(200));

    const result = await policy.execute(attempt);

    assert.equal(result.status, 200);
    assert.deepEqual(attempt.calls, [0]);
    assert.deepEqual(waits, []);
  });

  for (const status of RetryConstants.RetryableStatuses) {
    it(`Execute_RetryableStatusThenSuccess_RetriesWithExponentialBackoff (${status})`, async () => {
      const { policy, waits } = createPolicy();
      const attempt = scripted(response(status), response(status), response(200));

      const result = await policy.execute(attempt);

      assert.equal(result.status, 200);
      assert.deepEqual(attempt.calls, [0, 1, 2]);
      assert.deepEqual(waits, [500, 1000]);
    });
  }

  for (const status of [400, 401, 403, 404, 422]) {
    it(`Execute_ClientError_ReturnsItWithoutRetrying (${status})`, async () => {
      const { policy, waits } = createPolicy();
      const attempt = scripted(response(status), response(200));

      const result = await policy.execute(attempt);

      assert.equal(result.status, status);
      assert.deepEqual(attempt.calls, [0]);
      assert.deepEqual(waits, []);
    });
  }

  it('Execute_StillFailingAfterMaxRetries_ReturnsLastResponse', async () => {
    const { policy } = createPolicy();
    const attempt = scripted(response(503), response(502), response(500), response(200));

    const result = await policy.execute(attempt);

    assert.equal(result.status, 500);
    assert.deepEqual(attempt.calls, [0, 1, 2]);
  });

  it('Execute_UnreachableThenSuccess_Retries', async () => {
    const { policy, waits } = createPolicy();
    const attempt = scripted(connectionRefused(), response(200));

    const result = await policy.execute(attempt);

    assert.equal(result.status, 200);
    assert.deepEqual(waits, [500]);
  });

  it('Execute_TimeoutThenSuccess_Retries', async () => {
    const { policy, warnings } = createPolicy();
    const attempt = scripted(timedOut(), response(200));

    await policy.execute(attempt, { description: 'GET www.reed.co.uk/api/1.0/search' });

    assert.deepEqual(attempt.calls, [0, 1]);
    assert.deepEqual(warnings, ['GET www.reed.co.uk/api/1.0/search timed out; retry 1 of 2 in 500 ms.']);
  });

  it('Execute_StillUnreachableAfterMaxRetries_ThrowsLastError', async () => {
    const { policy } = createPolicy();
    const last = connectionRefused();
    const attempt = scripted(connectionRefused(), connectionRefused(), last);

    await assert.rejects(policy.execute(attempt), (error) => error === last);
    assert.deepEqual(attempt.calls, [0, 1, 2]);
  });

  it('Execute_CallerCancels_ThrowsWithoutRetrying', async () => {
    const { policy, waits } = createPolicy();
    const attempt = scripted(new DOMException('The operation was aborted', 'AbortError'), response(200));

    await assert.rejects(policy.execute(attempt), { name: 'AbortError' });
    assert.deepEqual(attempt.calls, [0]);
    assert.deepEqual(waits, []);
  });

  it('Execute_UnexpectedError_ThrowsWithoutRetrying', async () => {
    const { policy } = createPolicy();
    const attempt = scripted(new SyntaxError('not json'), response(200));

    await assert.rejects(policy.execute(attempt), SyntaxError);
    assert.deepEqual(attempt.calls, [0]);
  });

  it('Execute_RetryAfterSeconds_WaitsThatLongInstead', async () => {
    const { policy, waits } = createPolicy();
    const attempt = scripted(response(429, { 'Retry-After': '3' }), response(200));

    await policy.execute(attempt);

    assert.deepEqual(waits, [3000]);
  });

  it('Execute_RetryAfterDate_WaitsUntilThen', async () => {
    const now = Date.UTC(2026, 8, 25, 12, 0, 0);
    const { policy, waits } = createPolicy({ now: () => now });
    const attempt = scripted(response(503, { 'Retry-After': new Date(now + 2500).toUTCString() }), response(200));

    await policy.execute(attempt);

    assert.deepEqual(waits, [2000]); // HTTP-dates have whole seconds
  });

  it('Execute_RetryAfterTooLong_GivesUpAndReturnsResponse', async () => {
    const { policy, waits } = createPolicy();
    const attempt = scripted(response(503, { 'Retry-After': '120' }), response(200));

    const result = await policy.execute(attempt);

    assert.equal(result.status, 503);
    assert.deepEqual(attempt.calls, [0]);
    assert.deepEqual(waits, []);
  });

  it('Execute_RetryAfterUnreadable_FallsBackToBackoff', async () => {
    const { policy, waits } = createPolicy();
    const attempt = scripted(response(503, { 'Retry-After': 'soon' }), response(200));

    await policy.execute(attempt);

    assert.deepEqual(waits, [500]);
  });

  it('Execute_RetriedResponse_HasItsBodyReleased', async () => {
    const { policy } = createPolicy();
    const retried = response(503);
    const attempt = scripted(retried, response(200));

    await policy.execute(attempt);

    assert.equal(retried.bodyUsed, true);
  });

  it('Execute_EveryRetry_IsLoggedAsAWarning', async () => {
    const { policy, warnings } = createPolicy();
    const attempt = scripted(response(503), connectionRefused(), response(200));

    await policy.execute(attempt, { description: 'GET api.adzuna.com/v1/api/jobs/gb/search/1' });

    assert.deepEqual(warnings, [
      'GET api.adzuna.com/v1/api/jobs/gb/search/1 returned 503; retry 1 of 2 in 500 ms.',
      'GET api.adzuna.com/v1/api/jobs/gb/search/1 got no response; retry 2 of 2 in 1000 ms.',
    ]);
  });

  it('Execute_WaitingWhenCallerCancels_StopsWaiting', async () => {
    const controller = new AbortController();
    // Behaves like timers/promises' setTimeout: rejects when the signal aborts, including if it already has.
    const { policy } = createPolicy({
      sleep: (ms, signal) => new Promise((_, reject) => {
        if (signal.aborted) reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason));
      }),
    });
    const attempt = scripted(response(503), response(200));

    const pending = policy.execute(attempt, { signal: controller.signal });
    await Promise.resolve();
    controller.abort();

    await assert.rejects(pending, { name: 'AbortError' });
    assert.deepEqual(attempt.calls, [0]);
  });

  it('Execute_DefaultSleep_ReallyWaits', async () => {
    const policy = new RetryPolicy({ baseDelayMs: 20, random: () => 1 });
    const attempt = scripted(response(503), response(200));

    const started = Date.now();
    await policy.execute(attempt);

    assert.ok(Date.now() - started >= 15, 'should have slept ~20 ms');
  });

  // Backoff schedule

  it('BackoffMs_SuccessiveRetries_DoublesUpToTheCap', () => {
    const { policy } = createPolicy({ random: () => 1 });

    assert.deepEqual([1, 2, 3, 4, 5, 6].map((r) => policy.backoffMs(r)), [500, 1000, 2000, 4000, 8000, 8000]);
  });

  it('BackoffMs_Jitter_StaysBetweenHalfAndFullDelay', () => {
    const low = new RetryPolicy({ random: () => 0 });
    const high = new RetryPolicy({ random: () => 1 });
    const middle = new RetryPolicy({ random: () => 0.5 });

    assert.deepEqual([low.backoffMs(2), middle.backoffMs(2), high.backoffMs(2)], [500, 750, 1000]);
  });

  it('BackoffMs_RealJitter_VariesBetweenCalls', () => {
    const policy = new RetryPolicy();

    const delays = new Set(Array.from({ length: 50 }, () => policy.backoffMs(3)));

    assert.ok(delays.size > 1);
    assert.ok([...delays].every((d) => d >= 1000 && d <= 2000));
  });

  it('Constructor_CustomLimits_AreUsed', async () => {
    const { policy, waits } = createPolicy({ maxRetries: 5, baseDelayMs: 100, maxDelayMs: 300, random: () => 1 });
    const attempt = scripted(response(503), response(503), response(503), response(503), response(503), response(200));

    const result = await policy.execute(attempt);

    assert.equal(result.status, 200);
    assert.deepEqual(waits, [100, 200, 300, 300, 300]);
  });

  it('Constructor_ZeroRetries_MakesOneAttempt', async () => {
    const { policy } = createPolicy({ maxRetries: 0 });
    const attempt = scripted(response(503), response(200));

    assert.equal((await policy.execute(attempt)).status, 503);
    assert.deepEqual(attempt.calls, [0]);
  });
});

describe('retryAfterMs', () => {
  const now = () => Date.UTC(2026, 8, 25, 12, 0, 0);

  for (const [value, expected] of [
    [null, undefined],
    ['', undefined],
    ['0', 0],
    ['7', 7000],
    [' 7 ', 7000],
    ['Fri, 25 Sep 2026 12:00:10 GMT', 10000],
    ['Fri, 25 Sep 2026 11:00:00 GMT', 0],   // in the past
    ['tomorrow', undefined],
  ]) {
    it(`RetryAfterMs_${JSON.stringify(value)}_Is${expected}`, () => {
      assert.equal(retryAfterMs(value, now), expected);
    });
  }
});
