import { createError } from '../common/error.js';
import { ErrorCode } from '../common/errorCode.js';
import { HttpStatus } from '../common/httpStatus.js';
import { Result } from '../common/result.js';
import { SearchConstants } from '../constants/searchConstants.js';
import { JobSearchQuery, JobSearchResult } from '../models/jobSearch.js';
import { effectiveKeywords, splitKeywordString } from './searchOptions.js';

// What int.TryParse accepts: optional sign and digits, with surrounding whitespace.
const WholeNumber = /^\s*[+-]?\d+\s*$/;

/**
 * The body of every error response.
 * @param {ReadonlyArray<import('../common/error.js').AppError>} errors
 */
export const createErrorResponseBody = (errors) => Object.freeze({ errors: Object.freeze([...errors]) });

/**
 * GET /api/jobs?q=.NET,C#,backend engineer&days=7 (q is comma-separated; omit it for the configured keywords)
 *
 * Not read-only: it first collects (searches every source and stores what they return), then lists
 * the relevant stored adverts.
 * 400 for invalid input and 503 when the store can't be reached, both with `{ errors: [{ code, message }] }`;
 * 502 with the full result when every source failed. A source's own HTTP status is never passed through:
 * it's only reported on that source's entry.
 *
 * @param {object} deps
 * @param {import('../services/jobSearchService.js').IJobSearchService} deps.search
 * @param {import('./searchOptions.js').SearchOptions} deps.options
 * @returns {(request: { query: URLSearchParams }) => Promise<{ status: number, jsonBody: unknown }>}
 */
export function createGetJobsHandler({ search, options }) {
  return async function getJobs(request) {
    const queryResult = validate(queryValue(request, 'days'), splitKeywordString(queryValue(request, 'q')), options);
    if (!queryResult.isSuccess) {
      return errorResponse(queryResult.statusCode, queryResult.errors);
    }

    const query = queryResult.value;

    // Only the store fails the whole request.
    const collectResult = await search.collectAndStore(query);
    if (!collectResult.isSuccess) {
      return errorResponse(HttpStatus.ServiceUnavailable, collectResult.errors);
    }

    const collection = collectResult.value;
    const listResult = await search.list(query, collection.at);
    if (!listResult.isSuccess) {
      return errorResponse(HttpStatus.ServiceUnavailable, listResult.errors);
    }

    const found = new JobSearchResult(query.keywords, collection.sources, listResult.value);
    const everySourceFailed = found.sources.length > 0 && found.sources.every((s) => s.failed);
    return { status: everySourceFailed ? HttpStatus.BadGateway : HttpStatus.Ok, jsonBody: found };
  };
}

// Repeated parameters join with a comma, as ASP.NET's StringValues.ToString() does.
const queryValue = (request, name) => request.query.getAll(name).join(',');

// Reports every rule broken, not just the first.
/**
 * @param {string} daysParam
 * @param {string[]} requested
 * @param {import('./searchOptions.js').SearchOptions} options
 * @returns {Result<JobSearchQuery>}
 */
function validate(daysParam, requested, options) {
  const errors = [];

  let days = SearchConstants.DefaultMaxDaysOld;
  if (daysParam.length > 0) {
    days = WholeNumber.test(daysParam) ? Number(daysParam) : Number.NaN;
    if (!(days >= 1 && days <= SearchConstants.MaxAllowedDaysOld)) {
      errors.push(createError(ErrorCode.DaysOutOfRange, `days must be a whole number from 1 to ${SearchConstants.MaxAllowedDaysOld}.`));
    }
  }

  if (requested.length > SearchConstants.MaxKeywords) {
    errors.push(createError(ErrorCode.TooManyKeywords, `Give at most ${SearchConstants.MaxKeywords} keywords.`));
  }

  errors.push(...requested
    .filter((k) => k.length > SearchConstants.MaxKeywordLength)
    .map((k) => createError(ErrorCode.KeywordTooLong,
      `Keywords can be up to ${SearchConstants.MaxKeywordLength} characters: "${k.slice(0, SearchConstants.KeywordPreviewLength)}…" is longer.`)));

  if (errors.length > 0) {
    return Result.failure(HttpStatus.BadRequest, errors);
  }

  const keywords = requested.length > 0 ? requested : effectiveKeywords(options);
  return Result.success(new JobSearchQuery(keywords, days));
}

const errorResponse = (status, errors) => ({ status, jsonBody: createErrorResponseBody(errors) });
