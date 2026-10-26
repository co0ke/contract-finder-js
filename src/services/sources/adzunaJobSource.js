import { Result } from '../../common/result.js';
import { isBlank } from '../../common/strings.js';
import { AdzunaConstants } from '../../constants/adzunaConstants.js';
import { createJob } from '../../models/job.js';
import { DayRate } from './dayRate.js';
import { QueryString, escapeDataString } from './queryString.js';
import { SourceFailures } from './sourceFailures.js';

/**
 * @typedef {object} AdzunaOptions
 * @property {string} appId
 * @property {string} appKey
 * @property {string} country
 */

/** @param {Partial<AdzunaOptions>} [fields] @returns {AdzunaOptions} */
export const createAdzunaOptions = ({ appId = '', appKey = '', country = AdzunaConstants.DefaultCountry } = {}) =>
  Object.freeze({ appId, appKey, country });

// Anything that isn't a letter, digit or space, e.g. the dot in ".NET" or the hash in "C#".
const Punctuation = /[^\p{L}\p{Nd} ]/u;

/**
 * Contract roles from the Adzuna search API (https://developer.adzuna.com).
 * @implements {import('./jobSource.js').IJobSource}
 */
export class AdzunaJobSource {
  #http;
  #options;

  /**
   * @param {import('./httpClient.js').HttpClient} http
   * @param {AdzunaOptions} options
   */
  constructor(http, options) {
    this.#http = http;
    this.#options = options;
  }

  get name() {
    return AdzunaConstants.Name;
  }

  /** @param {import('../../models/jobSearch.js').JobSearchQuery} query */
  async search(query) {
    const o = this.#options;
    if (isBlank(o.appId) || isBlank(o.appKey)) {
      return SourceFailures.missingCredentials('Adzuna__AppId and Adzuna__AppKey must be configured.');
    }

    const searches = query.keywords.map((keyword) => this.#searchKeyword(o, keyword, query.maxDaysOld));
    return SourceFailures.combine(await Promise.all(searches));
  }

  /**
   * @param {AdzunaOptions} settings
   * @param {string} keyword
   * @param {number} maxDaysOld
   */
  async #searchKeyword(settings, keyword, maxDaysOld) {
    // Full-text "what" reduces ".NET" to "net" and matches e.g. "net salary" in any advert, so match
    // keywords with punctuation (".NET", "C#") against the job title only. Plain words search the whole advert.
    const titleOnly = Punctuation.test(keyword);
    const parameters = {
      app_id: settings.appId,
      app_key: settings.appKey,
      [titleOnly ? 'title_only' : 'what']: keyword,
      contract: '1',
      max_days_old: String(maxDaysOld),
      sort_by: 'date',
      results_per_page: String(AdzunaConstants.ResultsPerPage),
    };
    const url = `jobs/${escapeDataString(settings.country)}/search/1?${QueryString.build(parameters)}`;

    let response;
    try {
      response = await this.#http.get(url);
    } catch (error) {
      return SourceFailures.fromFetchError(this.name, error);
    }

    if (!response.ok) {
      return SourceFailures.httpError(this.name, response);
    }

    // Adzuna sends "charset=utf8"; the body is read as text and parsed directly (JSON is always UTF-8).
    /** @type {import('./dtos/adzunaDtos.js').AdzunaResponse} */
    const body = JSON.parse(await response.text());

    return Result.success((body?.results ?? []).map((j) => this.#toJob(j)));
  }

  /** @param {import('./dtos/adzunaDtos.js').AdzunaJob} j */
  #toJob(j) {
    return createJob({
      source: this.name,
      id: j.id,
      title: j.title,
      company: j.company?.display_name ?? null,
      location: j.location?.display_name ?? null,
      dayRateMin: DayRate.fromAdvertised(j.salary_min),
      dayRateMax: DayRate.fromAdvertised(j.salary_max),
      rateIsEstimated: isTruthy(j.salary_is_predicted),
      postedAt: j.created ? new Date(j.created) : null,
      url: j.redirect_url,
      snippet: j.description ?? null,
    });
  }
}

// Documented as a boolean, but the live API returns "0"/"1" strings.
function isTruthy(value) {
  switch (typeof value) {
    case 'boolean': return value;
    case 'string': return value === '1' || value === 'true';
    case 'number': return value !== 0;
    default: return false;
  }
}
