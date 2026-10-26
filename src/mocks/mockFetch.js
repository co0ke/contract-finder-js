import { AdzunaConstants } from '../constants/adzunaConstants.js';
import { EmagineConstants } from '../constants/emagineConstants.js';
import { JobServeConstants } from '../constants/jobServeConstants.js';
import { ReedConstants } from '../constants/reedConstants.js';
import { TechJobsConstants } from '../constants/techJobsConstants.js';
import { adzunaResponse, emagineResponse, jobServeBlockedPage, jobServePage, reedResponse, techJobsResponse } from './fixtures.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
const html = (body, status = 200) =>
  new Response(body, { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } });

/**
 * A `fetch` that answers for the job sites from canned data, routed by host. Unknown hosts fail as
 * unreachable, the way fetch itself reports a site it can't connect to.
 *
/**
 * How many times a flaky source fails each request before answering it. Within the retry budget, so the
 * source ends up working: to see retries run out, use a failing source that answers 503 (TechJobs).
 */
export const FlakyFailures = 2;

/**
 * @param {object} [options]
 * @param {import('../services/time.js').TimeProvider} [options.time]
 * @param {ReadonlyArray<string>} [options.failingSources] Source names that should fail every time, e.g. ["Reed", "JobServe"].
 * @param {ReadonlyArray<string>} [options.flakySources] Source names that 503 {@link FlakyFailures} times per request, then answer it.
 * @param {(entry: { url: string, init?: RequestInit }) => void} [options.onRequest] Called for every request, e.g. to log it.
 * @returns {typeof fetch}
 */
export function createMockFetch({ time = { now: () => new Date() }, failingSources = [], flakySources = [], onRequest = () => {} } = {}) {
  const failing = new Set(failingSources);
  const flaky = new Set(flakySources);
  // Failures still owed per distinct request. Retries re-send the same request, so each one sees the full
  // run of failures before it succeeds, and a later search starts the run again.
  const failuresLeft = new Map();

  // Per site: how it answers normally, and how it fails.
  const sites = new Map([
    [AdzunaConstants.BaseAddress.host, {
      name: AdzunaConstants.Name,
      ok: () => json(adzunaResponse(time.now())),
      failed: () => json({ exception: 'AUTH_FAIL', doc: 'https://developer.adzuna.com' }, 401),
    }],
    [ReedConstants.BaseAddress.host, { name: ReedConstants.Name, ok: () => json(reedResponse(time.now())), failed: () => json({}, 401) }],
    [EmagineConstants.BaseAddress.host, { name: EmagineConstants.Name, ok: () => json(emagineResponse()), failed: () => json({ error: 'Bad request' }, 400) }],
    [JobServeConstants.BaseAddress.host, { name: JobServeConstants.Name, ok: () => html(jobServePage(time.now())), failed: () => html(jobServeBlockedPage) }],
    [TechJobsConstants.BaseAddress.host, { name: TechJobsConstants.Name, ok: () => json(techJobsResponse(time.now())), failed: () => json({}, 503) }],
  ]);

  return async function mockFetch(input, init) {
    const url = typeof input === 'string' ? input : input.url ?? String(input);
    onRequest({ url, init });
    const site = sites.get(new URL(url).host);
    if (!site) {
      throw new TypeError('fetch failed', { cause: new Error(`getaddrinfo ENOTFOUND ${new URL(url).host} (mock)`) });
    }
    if (failing.has(site.name)) {
      return site.failed();
    }
    if (flaky.has(site.name)) {
      const key = `${init?.method ?? 'GET'} ${url} ${init?.body ?? ''}`;
      const left = failuresLeft.get(key) ?? FlakyFailures;
      if (left > 0) {
        failuresLeft.set(key, left - 1);
        return new Response('Service Unavailable (mock transient failure)', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
      failuresLeft.delete(key);
    }
    return site.ok();
  };
}
