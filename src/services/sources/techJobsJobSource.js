import { Result } from '../../common/result.js';
import { TechJobsConstants } from '../../constants/techJobsConstants.js';
import { createJob } from '../../models/job.js';
import { DayRate } from './dayRate.js';
import { QueryString } from './queryString.js';
import { SourceFailures } from './sourceFailures.js';

/**
 * Contract roles from the undocumented JSON API behind techjobs.co.uk.
 * @implements {import('./jobSource.js').IJobSource}
 */
export class TechJobsJobSource {
  #http;

  /** @param {import('./httpClient.js').HttpClient} http */
  constructor(http) {
    this.#http = http;
  }

  get name() {
    return TechJobsConstants.Name;
  }

  /** @param {import('../../models/jobSearch.js').JobSearchQuery} query */
  async search(query) {
    const searches = query.keywords.map((keyword) => this.#searchKeyword(keyword, query.maxDaysOld));
    return SourceFailures.combine(await Promise.all(searches));
  }

  /** @param {string} keyword @param {number} maxDaysOld */
  async #searchKeyword(keyword, maxDaysOld) {
    const parameters = {
      q: keyword,
      jobTypes: TechJobsConstants.ContractJobTypes,
      postedWithinDays: String(maxDaysOld),
      limit: String(TechJobsConstants.ResultsToTake),
    };

    let response;
    try {
      response = await this.#http.get(`api/jobs/search?${QueryString.build(parameters)}`);
    } catch (error) {
      return SourceFailures.fromFetchError(this.name, error);
    }

    if (!response.ok) {
      return SourceFailures.httpError(this.name, response);
    }
    /** @type {import('./dtos/techJobsDtos.js').TechJobsResponse} */
    const body = await response.json();
    return Result.success((body?.jobs ?? []).map((j) => this.#toJob(j)));
  }

  /** @param {import('./dtos/techJobsDtos.js').TechJobsJob} j */
  #toJob(j) {
    // Annual figures on contract roles are usually the recruiter's ceiling, not a day rate.
    const isDaily = typeof j.salaryType === 'string' && j.salaryType.toLowerCase() === TechJobsConstants.DailySalaryType;
    return createJob({
      source: this.name,
      id: j.id,
      title: j.title,
      company: j.organizationName ?? null,
      location: j.town ?? j.city ?? TechJobsConstants.FallbackLocation,
      dayRateMin: isDaily ? DayRate.fromAdvertised(toNumber(j.salaryMin)) : null,
      dayRateMax: isDaily ? DayRate.fromAdvertised(toNumber(j.salaryMax)) : null,
      rateIsEstimated: false,
      postedAt: j.postedAt ? new Date(j.postedAt) : null,
      url: `${TechJobsConstants.JobUrlPrefix}${j.slug}`,
      snippet: j.shortDescription ?? null,
    });
  }
}

// Salaries arrive as strings ("400.00"); the C# DTO allowed reading numbers from strings.
function toNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const number = Number(value);
  if (Number.isNaN(number)) {
    throw new SyntaxError(`Not a number: ${JSON.stringify(value)}`);
  }
  return number;
}
