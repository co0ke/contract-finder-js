import { Result } from '../src/common/result.js';
import { createError } from '../src/common/error.js';
import { ErrorCode } from '../src/common/errorCode.js';
import { createJob } from '../src/models/job.js';
import { InMemoryJobStore } from '../src/services/storage/inMemoryJobStore.js';

export { InMemoryJobStore };

/** A UTC instant, like `new DateTimeOffset(y, M, d, h, m, s, TimeSpan.Zero)`. Month is 1-based. */
export const utc = (year, month, day, hour = 0, minute = 0, second = 0, ms = 0) =>
  new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));

const MsPerDay = 24 * 60 * 60 * 1000;
export const addDays = (date, days) => new Date(date.getTime() + days * MsPerDay);
export const addHours = (date, hours) => new Date(date.getTime() + hours * 60 * 60 * 1000);

/**
 * A recorded request, with the bits the tests look at.
 * @typedef {{ method: string, url: URL, headers: Headers, body: string | null }} RecordedRequest
 */

/**
 * A `fetch` that always answers the same, recording every request. The C# StubHttpHandler.
 * @param {number} status
 * @param {string} body
 * @param {string} [contentType] Set raw so tests can reproduce non-standard values sent by real APIs.
 * @returns {typeof fetch & { requests: RecordedRequest[] }}
 */
export function stubFetch(status, body, contentType = 'application/json; charset=utf-8') {
  const requests = [];
  const fetchStub = async (url, init = {}) => {
    requests.push({
      method: init.method ?? 'GET',
      url: new URL(url),
      headers: new Headers(init.headers ?? {}),
      body: typeof init.body === 'string' ? init.body : null,
    });
    return new Response(body, { status, headers: { 'Content-Type': contentType } });
  };
  fetchStub.requests = requests;
  return fetchStub;
}

/** Throws instead of responding, e.g. to simulate no connection or a timeout. The C# ThrowingHttpHandler. */
export function throwingFetch(error) {
  return async () => {
    throw error;
  };
}

/** How fetch reports a site it can't connect to (the C# HttpRequestException). */
export const connectionRefused = () =>
  new TypeError('fetch failed', { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }) });

/** How fetch reports its own timeout (AbortSignal.timeout), as opposed to the caller cancelling. */
export const timedOut = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

/** The C# FixedTimeProvider. @param {Date} now */
export const fixedTime = (now) => Object.freeze({ now: () => now });

/** @implements {import('../src/services/sources/jobSource.js').IJobSource} */
export class FakeJobSource {
  #search;
  /** @type {import('../src/models/jobSearch.js').JobSearchQuery | null} */
  lastQuery = null;

  /**
   * @param {string} name
   * @param {() => ReadonlyArray<import('../src/models/job.js').Job>} search
   */
  constructor(name, search) {
    this.name = name;
    this.#search = () => Result.success(search());
  }

  /** A source that reports an expected failure. */
  static failing(name, status, ...errors) {
    const source = new FakeJobSource(name, () => []);
    source.#search = () => Result.failure(status, errors);
    return source;
  }

  async search(query) {
    this.lastQuery = query;
    return this.#search();
  }
}

/** The C# Jobs.Make helper. */
export function makeJob({
  source = 'Test',
  id = '1',
  title = '.NET Developer',
  company = 'Acme',
  dayRateMin = null,
  dayRateMax = null,
  estimated = false,
  postedAt = null,
  snippet = null,
} = {}) {
  return createJob({
    source, id, title, company, location: 'London', dayRateMin, dayRateMax, rateIsEstimated: estimated, postedAt,
    url: `https://example.com/${source}/${id}`, snippet,
  });
}

/**
 * A store that can't be reached. By default every call fails; with `failUpserts` only `upsert` does,
 * to simulate the store going away part-way through a search.
 * @implements {import('../src/services/storage/jobStore.js').IJobStore}
 */
export class UnavailableJobStore {
  static Unavailable = createError(ErrorCode.StoreUnavailable, "Can't reach table storage.");

  #working = new InMemoryJobStore();
  #failEverything;

  constructor(failUpserts = false) {
    this.#failEverything = !failUpserts;
  }

  async upsert() {
    return Result.failure(500, UnavailableJobStore.Unavailable);
  }

  query(since) {
    return this.#failEverything ? Promise.resolve(Result.failure(500, UnavailableJobStore.Unavailable)) : this.#working.query(since);
  }

  recordRun(run) {
    return this.#failEverything ? Promise.resolve(Result.failure(500, UnavailableJobStore.Unavailable)) : this.#working.recordRun(run);
  }

  getRecentRuns(source, count) {
    return this.#failEverything
      ? Promise.resolve(Result.failure(500, UnavailableJobStore.Unavailable))
      : this.#working.getRecentRuns(source, count);
  }

  deleteOlderThan(cutoff) {
    return this.#failEverything ? Promise.resolve(Result.failure(500, UnavailableJobStore.Unavailable)) : this.#working.deleteOlderThan(cutoff);
  }
}

/** xUnit's Assert.Single: the only element, or an assertion failure. */
export function single(items, message = `Expected exactly one item, found ${items.length}.`) {
  if (items.length !== 1) {
    throw new Error(message);
  }
  return items[0];
}
