import { distinctBy } from '../../common/collections.js';
import { createError } from '../../common/error.js';
import { ErrorCode } from '../../common/errorCode.js';
import { HttpStatus } from '../../common/httpStatus.js';
import { Result } from '../../common/result.js';
import { isTimeoutError, isUnreachableError, reasonPhrase } from './httpClient.js';

/**
 * The failures every source reports the same way. Each source still catches fetch's errors itself,
 * right where it sends the request.
 */
export const SourceFailures = Object.freeze({
  /** @param {string} source @param {Response} response */
  httpError(source, response) {
    return Result.failure(response.status, createError(
      ErrorCode.SourceHttpError, `${source} returned ${response.status} ${reasonPhrase(response)}.`));
  },

  /** @param {string} source @param {Error} error */
  unreachable(source, error) {
    return Result.failure(HttpStatus.InternalServerError, createError(
      ErrorCode.SourceUnreachable, `Couldn't reach ${source}: ${error.cause instanceof Error ? error.cause.message : error.message}`));
  },

  /** @param {string} source */
  timeout(source) {
    return Result.failure(HttpStatus.InternalServerError, createError(ErrorCode.SourceTimeout, `${source} didn't respond in time.`));
  },

  /**
   * Turns what fetch threw into the matching failure: unreachable or timeout. Anything else (the caller
   * cancelling, a bug) is rethrown, as the C# sources only caught HttpRequestException and HttpClient's timeout.
   * @param {string} source
   * @param {unknown} error
   */
  fromFetchError(source, error) {
    if (isTimeoutError(error)) {
      return SourceFailures.timeout(source);
    }
    if (isUnreachableError(error)) {
      return SourceFailures.unreachable(source, error);
    }
    throw error;
  },

  /** @param {string} message */
  missingCredentials(message) {
    return Result.failure(HttpStatus.InternalServerError, createError(ErrorCode.SourceMissingCredentials, message));
  },

  /**
   * Merges one search per keyword: any failure fails the source, with every failed keyword's errors and the
   * first failure's status. Otherwise each advert once.
   * @param {ReadonlyArray<import('../../common/result.js').Result<ReadonlyArray<import('../../models/job.js').Job>>>} perKeywordResults
   * @returns {import('../../common/result.js').Result<ReadonlyArray<import('../../models/job.js').Job>>}
   */
  combine(perKeywordResults) {
    const failedResults = perKeywordResults.filter((keywordResult) => !keywordResult.isSuccess);
    if (failedResults.length > 0) {
      return Result.failure(failedResults[0].statusCode, failedResults.flatMap((failedResult) => failedResult.errors));
    }
    return Result.success(distinctBy(perKeywordResults.flatMap((keywordResult) => keywordResult.value), (j) => j.id));
  },
});

