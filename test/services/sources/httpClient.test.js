import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpClient, reasonPhrase } from '../../../src/services/sources/httpClient.js';
import { RetryPolicy } from '../../../src/services/sources/retryPolicy.js';
import { connectionRefused, stubFetch } from '../../testDoubles.js';

const Base = 'https://example.test/api/';

const instantPolicy = (options = {}) => new RetryPolicy({ sleep: async () => {}, ...options });

/** A fetch that fails `failures` times (by status or thrown error) and then answers 200. */
function flakyFetch(failures, { status = 503, error = null } = {}) {
  const requests = [];
  const fetchFlaky = async (url, init) => {
    requests.push({ url: new URL(url), init });
    if (requests.length <= failures) {
      if (error) throw error;
      return new Response('down', { status });
    }
    return new Response('{"ok":true}', { status: 200 });
  };
  fetchFlaky.requests = requests;
  return fetchFlaky;
}

describe('HttpClient', () => {
  it('Send_RelativeUrl_ResolvesAgainstBaseAddress', async () => {
    const handler = stubFetch(200, '{}');

    await new HttpClient(Base, handler).get('jobs/1?x=y');

    assert.equal(handler.requests[0].url.toString(), 'https://example.test/api/jobs/1?x=y');
  });

  it('Send_NoRetryPolicy_MakesOneAttempt', async () => {
    const handler = flakyFetch(1);

    const response = await new HttpClient(Base, handler).get('x');

    assert.equal(response.status, 503);
    assert.equal(handler.requests.length, 1);
  });

  it('Send_RetryPolicyAndTransientStatus_RetriesUntilSuccess', async () => {
    const handler = flakyFetch(2);

    const response = await new HttpClient(Base, handler, { retry: instantPolicy() }).get('x');

    assert.equal(response.status, 200);
    assert.equal(handler.requests.length, 3);
  });

  it('Send_RetryPolicyAndUnreachable_RetriesUntilSuccess', async () => {
    const handler = flakyFetch(1, { error: connectionRefused() });

    const response = await new HttpClient(Base, handler, { retry: instantPolicy() }).get('x');

    assert.equal(response.status, 200);
    assert.equal(handler.requests.length, 2);
  });

  it('Send_RetryPolicyAndClientError_DoesNotRetry', async () => {
    const handler = flakyFetch(1, { status: 401 });

    const response = await new HttpClient(Base, handler, { retry: instantPolicy() }).get('x');

    assert.equal(response.status, 401);
    assert.equal(handler.requests.length, 1);
  });

  it('Send_RetriedPost_ResendsTheSameBody', async () => {
    const handler = flakyFetch(1);

    await new HttpClient(Base, handler, { retry: instantPolicy() }).postJson('search', { q: 1 });

    assert.deepEqual(handler.requests.map((r) => r.init.body), ['{"q":1}', '{"q":1}']);
    assert.deepEqual(handler.requests.map((r) => r.init.method), ['POST', 'POST']);
  });

  it('Send_EachAttempt_GetsItsOwnTimeoutSignal', async () => {
    const handler = flakyFetch(1);

    await new HttpClient(Base, handler, { retry: instantPolicy() }).get('x');

    const [first, second] = handler.requests.map((r) => r.init.signal);
    assert.ok(first instanceof AbortSignal && second instanceof AbortSignal);
    assert.notEqual(first, second);
  });

  it('Send_CallerSignalAborted_StopsWithoutRetrying', async () => {
    const controller = new AbortController();
    controller.abort();
    const handler = async (url, init) => { init.signal.throwIfAborted(); return new Response('', { status: 200 }); };

    await assert.rejects(
      new HttpClient(Base, handler, { retry: instantPolicy() }).get('x', { signal: controller.signal }),
      { name: 'AbortError' });
  });

  it('Send_Retry_LogsHostAndPathButNotQueryString', async () => {
    const warnings = [];
    const handler = flakyFetch(1);
    const retry = instantPolicy({ logger: { info() {}, warn: (line) => warnings.push(line), error() {} } });

    await new HttpClient(Base, handler, { retry }).get('jobs/gb/search/1?app_id=id&app_key=secret');

    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /^GET example\.test\/api\/jobs\/gb\/search\/1 returned 503; retry 1 of 2/);
    assert.ok(!warnings[0].includes('secret'));
  });

  it('ReasonPhrase_EmptyStatusText_UsesStandardPhrase', () => {
    assert.equal(reasonPhrase(new Response('', { status: 503 })), 'Service Unavailable');
    assert.equal(reasonPhrase(new Response('', { status: 503, statusText: 'Down' })), 'Down');
    assert.equal(reasonPhrase(new Response('', { status: 299 })), '');
  });
});
