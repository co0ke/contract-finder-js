import * as cheerio from 'cheerio';
import { distinctBy } from '../../common/collections.js';
import { createError } from '../../common/error.js';
import { ErrorCode } from '../../common/errorCode.js';
import { HttpStatus } from '../../common/httpStatus.js';
import { Result } from '../../common/result.js';
import { JobServeConstants } from '../../constants/jobServeConstants.js';
import { createJob } from '../../models/job.js';
import { JobServeRate } from './jobServeRate.js';
import { localToUtc } from './localTime.js';
import { QueryString } from './queryString.js';
import { SourceFailures } from './sourceFailures.js';

const PageNumber = /(?<prefix>[?&]page=)(?<page>\d+)/;
const EveryPageNumber = new RegExp(PageNumber.source, 'g');

/**
 * UK contract roles from JobServe (https://www.jobserve.com/gb/en/Job-Search/).
 * There is no API; this reads the HTML search results page.
 * @implements {import('./jobSource.js').IJobSource}
 */
export class JobServeJobSource {
  #http;
  #time;

  /**
   * @param {import('./httpClient.js').HttpClient} http
   * @param {import('../time.js').TimeProvider} time
   */
  constructor(http, time) {
    this.#http = http;
    this.#time = time;
  }

  get name() {
    return JobServeConstants.Name;
  }

  /** @param {import('../../models/jobSearch.js').JobSearchQuery} query */
  async search(query) {
    // One request at a time, so the first failure (often blocking) ends the search.
    const pages = [];
    for (const keyword of query.keywords) {
      const keywordPagesResult = await this.#getPages(keyword);
      if (!keywordPagesResult.isSuccess) {
        return Result.failure(keywordPagesResult.statusCode, keywordPagesResult.errors);
      }
      pages.push(...keywordPagesResult.value);
    }

    const cutoff = query.postedSince(this.#time.now());

    const items = pages.flatMap(($) => $('.jobListItem').toArray().map((element) => ({ $, element })));
    const jobs = items
      .filter(({ $, element }) => text($, element, '#summtype')?.toLowerCase().includes(JobServeConstants.ContractType.toLowerCase()) === true)
      .map(({ $, element }) => this.#toJob($, element));

    return Result.success(distinctBy(jobs, (j) => j.id)
      .filter((j) => j.postedAt === null || j.postedAt.getTime() >= cutoff.getTime()));
  }

  /** @param {string} keyword */
  async #getPages(keyword) {
    const parameters = {
      q: keyword,
      lq: JobServeConstants.Country,
    };
    const firstPageResult = await this.#getPage(`JobListing.aspx?${QueryString.build(parameters)}`);
    if (!firstPageResult.isSuccess) {
      return Result.failure(firstPageResult.statusCode, firstPageResult.errors);
    }
    const firstPage = firstPageResult.value;

    // Only the paging links carry the saved search id (shid) that later pages need.
    const pages = [firstPage];
    const nextPageLink = firstPage("a[title='Next Page']").attr('href');
    if (nextPageLink !== undefined) {
      const pageCount = Math.min(lastPage(firstPage), JobServeConstants.MaxPages);
      for (let page = 2; page <= pageCount; page++) {
        const nextPageResult = await this.#getPage(nextPageLink.replace(EveryPageNumber, `$<prefix>${page}`));
        if (!nextPageResult.isSuccess) {
          return Result.failure(nextPageResult.statusCode, nextPageResult.errors);
        }
        pages.push(nextPageResult.value);
      }
    }
    return Result.success(pages);
  }

  /** @param {string} url */
  async #getPage(url) {
    let response;
    try {
      response = await this.#http.get(url);
    } catch (error) {
      return SourceFailures.fromFetchError(this.name, error);
    }

    if (!response.ok) {
      return SourceFailures.httpError(this.name, response);
    }
    const html = await response.text();
    // A leading byte-order mark would otherwise be read as body text.
    const document = cheerio.load(html.replace(/^\uFEFF/, ''));

    // When blocking, JobServe returns 200 with an empty <body> rather than an error status.
    if (document('body').children().length === 0) {
      return Result.failure(HttpStatus.InternalServerError, createError(
        ErrorCode.SourceBlocked, 'JobServe returned an empty page; it may be blocking requests.'));
    }
    return Result.success(document);
  }

  /**
   * @param {import('cheerio').CheerioAPI} $
   * @param {import('domhandler').Element} item
   */
  #toJob($, item) {
    const link = $(item).find('a.jobListPosition').first();
    const { min: rateMin, max: rateMax } = JobServeRate.parse(text($, item, '#summrate'));
    return createJob({
      source: this.name,
      id: $(item).attr('id'),
      title: link.text().trim(),
      company: company($, item),
      location: text($, item, '#summlocation'),
      dayRateMin: rateMin,
      dayRateMax: rateMax,
      rateIsEstimated: false,
      postedAt: parseDate(text($, item, '#summposteddate')),
      url: new URL(link.attr('href'), JobServeConstants.BaseAddress).toString(),
      snippet: snippet($, item),
    });
  }
}

/** @param {import('cheerio').CheerioAPI} page */
function lastPage(page) {
  const numbers = page('#jobListPagingControl a[href]').toArray()
    .map((a) => PageNumber.exec(page(a).attr('href')))
    .filter((m) => m !== null)
    .map((m) => Number(m.groups.page));
  return numbers.length > 0 ? Math.max(...numbers) : 1;
}

function text($, item, selector) {
  const value = $(item).find(selector).first().text().trim();
  return value.length === 0 ? null : value;
}

// The advertiser is labelled by its kind: "Employment Business", "Employment Agency" or "Company".
function company($, item) {
  const label = $(item).find('label.jobListLabel').toArray()
    .find((l) => JobServeConstants.CompanyLabels.includes($(l).text().trim()));
  if (!label) {
    return null;
  }
  const sibling = $(label).next();
  return sibling.length === 0 ? null : sibling.text().trim();
}

// The summary ends with a "more ->" link to the full advert.
function snippet($, item) {
  const summary = $(item).find('p.jobListSkills').first();
  if (summary.length === 0) {
    return null;
  }
  summary.find('a').first().remove();
  const value = summary.text().replaceAll('\u00A0', ' ').trim();
  return value.length > 0 ? value : null;
}

// dd/MM/yyyy HH:mm:ss, UK local time.
/** @param {string | null} value */
function parseDate(value) {
  const match = value === null ? null : JobServeConstants.DatePattern.exec(value);
  if (!match) {
    return null;
  }
  const [, day, month, year, hour, minute, second] = match.map(Number);
  const date = localToUtc(JobServeConstants.UkTimeZoneId, { year, month, day, hour, minute, second });
  return Number.isNaN(date.getTime()) ? null : date;
}
