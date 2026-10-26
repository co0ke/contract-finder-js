import { Result } from '../../common/result.js';
import { isBlank } from '../../common/strings.js';
import { ReedConstants } from '../../constants/reedConstants.js';
import { createJob } from '../../models/job.js';
import { DayRate } from './dayRate.js';
import { QueryString } from './queryString.js';
import { SourceFailures } from './sourceFailures.js';

/**
 * @typedef {object} ReedOptions
 * @property {string} apiKey
 */

/** @param {Partial<ReedOptions>} [fields] @returns {ReedOptions} */
export const createReedOptions = ({ apiKey = '' } = {}) => Object.freeze({ apiKey });

/**
 * Contract roles from the Reed.co.uk jobseeker API (https://www.reed.co.uk/developers/jobseeker).
 * @implements {import('./jobSource.js').IJobSource}
 */
export class ReedJobSource {
  #http;
  #options;
  #time;

  /**
   * @param {import('./httpClient.js').HttpClient} http
   * @param {ReedOptions} options
   * @param {import('../time.js').TimeProvider} time
   */
  constructor(http, options, time) {
    this.#http = http;
    this.#options = options;
    this.#time = time;
  }

  get name() {
    return ReedConstants.Name;
  }

  /** @param {import('../../models/jobSearch.js').JobSearchQuery} query */
  async search(query) {
    const apiKey = this.#options.apiKey;
    if (isBlank(apiKey)) {
      return SourceFailures.missingCredentials('Reed__ApiKey must be configured.');
    }

    const searches = query.keywords.map((keyword) => this.#searchKeyword(apiKey, keyword));
    const combinedResult = SourceFailures.combine(await Promise.all(searches));
    if (!combinedResult.isSuccess) {
      return combinedResult;
    }

    // Reed has no "max days old" filter, so apply it here.
    const cutoff = query.postedSince(this.#time.now());

    // Reed searches the whole advert and matches ".NET" as "net" (net pay, network...). That's left to the
    // search service's relevance rules, which see the title and description.
    return Result.success(combinedResult.value
      .filter((j) => j.postedAt === null || j.postedAt.getTime() >= cutoff.getTime()));
  }

  /** @param {string} apiKey @param {string} keyword */
  async #searchKeyword(apiKey, keyword) {
    const parameters = {
      keywords: keyword,
      contract: 'true',
      resultsToTake: String(ReedConstants.ResultsToTake),
    };

    let response;
    try {
      // Reed uses basic auth with the API key as the username and an empty password.
      response = await this.#http.get(`search?${QueryString.build(parameters)}`, {
        headers: { Authorization: `Basic ${Buffer.from(`${apiKey}:`, 'utf8').toString('base64')}` },
      });
    } catch (error) {
      return SourceFailures.fromFetchError(this.name, error);
    }

    if (!response.ok) {
      return SourceFailures.httpError(this.name, response);
    }
    /** @type {import('./dtos/reedDtos.js').ReedResponse} */
    const body = await response.json();
    return Result.success((body?.results ?? []).map((j) => this.#toJob(j)));
  }

  /** @param {import('./dtos/reedDtos.js').ReedJob} j */
  #toJob(j) {
    return createJob({
      source: this.name,
      id: String(j.jobId),
      title: j.jobTitle,
      company: j.employerName ?? null,
      location: j.locationName ?? null,
      dayRateMin: DayRate.fromAdvertised(j.minimumSalary),
      dayRateMax: DayRate.fromAdvertised(j.maximumSalary),
      rateIsEstimated: false,
      postedAt: parseDate(j.date),
      url: j.jobUrl,
      snippet: j.jobDescription ?? null,
    });
  }
}

// dd/MM/yyyy, read as UTC.
/** @param {string | null | undefined} value */
function parseDate(value) {
  const match = typeof value === 'string' ? ReedConstants.DatePattern.exec(value) : null;
  if (!match) {
    return null;
  }
  const [, day, month, year] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  // Reject impossible dates such as 31/02, which Date.UTC would roll over.
  return date.getUTCDate() === day && date.getUTCMonth() === month - 1 ? date : null;
}
