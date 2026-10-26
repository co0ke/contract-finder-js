import { HttpConstants } from '../../constants/httpConstants.js';

/**
 * The little of System.Net.Http.HttpClient the sources use: a base address, a timeout and an injectable
 * transport (`fetch`), which is how tests and the mock mode avoid real HTTP.
 */
export class HttpClient {
  #baseAddress;
  #fetch;
  #timeoutMs;
  #retry;

  /**
   * @param {URL | string} baseAddress
   * @param {typeof fetch} [fetchImpl] Defaults to the global fetch.
   * @param {object} [options]
   * @param {number} [options.timeoutMs] Per attempt.
   * @param {import('./retryPolicy.js').RetryPolicy | null} [options.retry] None by default: attached in composition, like a .NET resilience handler.
   */
  constructor(baseAddress, fetchImpl = globalThis.fetch, { timeoutMs = HttpConstants.RequestTimeoutMs, retry = null } = {}) {
    this.#baseAddress = new URL(baseAddress);
    this.#fetch = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#retry = retry;
  }

  get baseAddress() {
    return this.#baseAddress;
  }

  /**
   * Sends a request for a URL relative to the base address, retrying per the policy when there is one.
   * Throws what fetch throws: a TypeError when the site can't be reached, a TimeoutError when it's too slow.
   * @param {string} relativeUrl
   * @param {RequestInit} [init]
   * @returns {Promise<Response>}
   */
  send(relativeUrl, init = {}) {
    const url = new URL(relativeUrl, this.#baseAddress);
    const attempt = () => this.#fetch(url.toString(), { ...init, signal: this.#attemptSignal(init.signal) });
    if (this.#retry === null) {
      return attempt();
    }
    // Host and path only: the query string can carry credentials (Adzuna's app_key).
    const description = `${init.method ?? 'GET'} ${url.host}${url.pathname}`;
    return this.#retry.execute(attempt, { description, signal: init.signal });
  }

  // Each attempt gets its own timeout; the caller's signal, if any, still cancels everything.
  #attemptSignal(callerSignal) {
    const timeout = AbortSignal.timeout(this.#timeoutMs);
    return callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
  }

  /** @param {string} relativeUrl @param {RequestInit} [init] */
  get(relativeUrl, init = {}) {
    return this.send(relativeUrl, { ...init, method: 'GET' });
  }

  /**
   * The equivalent of PostAsJsonAsync.
   * @param {string} relativeUrl
   * @param {unknown} body
   * @param {RequestInit} [init]
   */
  postJson(relativeUrl, body, init = {}) {
    return this.send(relativeUrl, {
      ...init,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...(init.headers ?? {}) },
      body: JSON.stringify(body),
    });
  }
}

/** Whether fetch gave up waiting for the site, as opposed to the caller cancelling or the site being unreachable. */
export const isTimeoutError = (error) => error instanceof Error && error.name === 'TimeoutError';

/** Whether fetch couldn't get a response at all (DNS, refused connection, reset...). */
export const isUnreachableError = (error) => error instanceof TypeError;

// fetch leaves statusText empty when the server (or a test stub) gives none; .NET fills in the standard phrase.
const ReasonPhrases = new Map([
  [200, 'OK'], [201, 'Created'], [204, 'No Content'], [301, 'Moved Permanently'], [302, 'Found'],
  [400, 'Bad Request'], [401, 'Unauthorized'], [403, 'Forbidden'], [404, 'Not Found'], [405, 'Method Not Allowed'],
  [408, 'Request Timeout'], [409, 'Conflict'], [410, 'Gone'], [429, 'Too Many Requests'],
  [500, 'Internal Server Error'], [501, 'Not Implemented'], [502, 'Bad Gateway'], [503, 'Service Unavailable'],
  [504, 'Gateway Timeout'],
]);

/** @param {Response} response */
export const reasonPhrase = (response) => response.statusText || ReasonPhrases.get(response.status) || '';
