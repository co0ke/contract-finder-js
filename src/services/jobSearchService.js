import { groupBy } from '../common/collections.js';
import { createError } from '../common/error.js';
import { ErrorCode } from '../common/errorCode.js';
import { HttpStatus } from '../common/httpStatus.js';
import { Result } from '../common/result.js';
import { SourceHealthConstants } from '../constants/sourceHealthConstants.js';
import { SourceStatus, createJobCollection, createSourceRun } from '../models/jobSearch.js';
import { RelevanceRules } from './relevanceRules.js';
import { SourceHealth } from './sourceHealth.js';

/**
 * @typedef {object} IJobSearchService
 * @property {(query: import('../models/jobSearch.js').JobSearchQuery) => Promise<import('../common/result.js').Result<import('../models/jobSearch.js').JobCollection>>} collectAndStore
 *   Searches every source, records each source's run and stores every advert returned. A failing source is
 *   reported in the collection's sources; only an unreachable store fails the whole result.
 * @property {(query: import('../models/jobSearch.js').JobSearchQuery, collectedAt: Date) => Promise<import('../common/result.js').Result<ReadonlyArray<import('../models/job.js').Job>>>} list
 *   Lists the relevant stored adverts posted within the query's days, including those from earlier
 *   collections, marking the ones first seen at `collectedAt` as new. Writes nothing.
 */

/**
 * Collects adverts (queries every job source in parallel and stores what they return), and separately lists
 * the relevant stored adverts: de-duplicated and sorted newest first.
 * @implements {IJobSearchService}
 */
export class JobSearchService {
  #sources;
  #store;
  #time;
  #logger;

  /**
   * @param {Iterable<import('./sources/jobSource.js').IJobSource>} sources
   * @param {import('./storage/jobStore.js').IJobStore} store
   * @param {import('./time.js').TimeProvider} time
   * @param {import('./logger.js').Logger} logger
   */
  constructor(sources, store, time, logger) {
    this.#sources = [...sources];
    this.#store = store;
    this.#time = time;
    this.#logger = logger;
  }

  /** @param {import('../models/jobSearch.js').JobSearchQuery} query */
  async collectAndStore(query) {
    const now = this.#time.now();
    const results = await Promise.all(this.#sources.map((source) => this.#searchSource(source, query)));

    // Any store failure ends the collection: without the store there's nothing reliable to list.
    const statuses = [];
    for (const { status } of results) {
      const recordResult = await this.#recordRun(status, now);
      if (!recordResult.isSuccess) {
        return Result.failure(recordResult.statusCode, recordResult.errors);
      }
      statuses.push(recordResult.value);
    }

    const upsertResult = await this.#store.upsert(results.flatMap((r) => r.jobs), now);
    if (!upsertResult.isSuccess) {
      return Result.failure(upsertResult.statusCode, upsertResult.errors);
    }

    return Result.success(createJobCollection(now, statuses));
  }

  /**
   * @param {import('../models/jobSearch.js').JobSearchQuery} query
   * @param {Date} collectedAt
   */
  async list(query, collectedAt) {
    // Stored adverts, not just the last collection's: a source can miss an advert it returned last time
    // (e.g. one that only reads its first few result pages), and it should still be listed.
    const storedResult = await this.#store.query(query.postedSince(collectedAt));
    if (!storedResult.isSuccess) {
      return Result.failure(storedResult.statusCode, storedResult.errors);
    }

    const listed = storedResult.value
      .map((j) => Object.freeze({
        ...j,
        relevance: RelevanceRules.classify(j),
        isNew: j.firstSeenAt !== null && j.firstSeenAt.getTime() >= collectedAt.getTime(),
      }))
      .filter((j) => RelevanceRules.isListed(j.relevance));

    const jobs = [...groupBy(listed, duplicateKey).values()]
      .map(pickBest)
      .sort((a, b) => postedTime(b) - postedTime(a));

    return Result.success(Object.freeze(jobs));
  }

  /**
   * @param {import('./sources/jobSource.js').IJobSource} source
   * @param {import('../models/jobSearch.js').JobSearchQuery} query
   * @returns {Promise<{ status: SourceStatus, jobs: ReadonlyArray<import('../models/job.js').Job> }>}
   */
  async #searchSource(source, query) {
    try {
      const result = await source.search(query);
      if (!result.isSuccess) {
        this.#logger.warn(`Job source ${source.name} failed with ${result.statusCode}:`, result.errors);
        return { status: new SourceStatus(source.name, 0, { upstreamStatus: result.statusCode, errors: result.errors }), jobs: [] };
      }
      return { status: new SourceStatus(source.name, result.value.length), jobs: result.value };
    } catch (error) {
      // Safety net only: expected failures arrive as results. This is a bug or a changed layout, and one
      // broken source shouldn't hide results from the others. Details stay in the log.
      this.#logger.error(`Job source ${source.name} threw unexpectedly`, error);
      const appError = createError(ErrorCode.SourceUnexpected, `Unexpected error searching ${source.name}.`);
      return { status: new SourceStatus(source.name, 0, { upstreamStatus: HttpStatus.InternalServerError, errors: [appError] }), jobs: [] };
    }
  }

  // Judge the count against earlier runs before adding this one to the history.
  /**
   * @param {SourceStatus} status
   * @param {Date} now
   * @returns {Promise<import('../common/result.js').Result<SourceStatus>>}
   */
  async #recordRun(status, now) {
    if (!status.failed) {
      const recentRunsResult = await this.#store.getRecentRuns(status.name, SourceHealthConstants.RunsToFetch);
      if (!recentRunsResult.isSuccess) {
        return Result.failure(recentRunsResult.statusCode, recentRunsResult.errors);
      }
      status = status.with({ warning: SourceHealth.warning(status.count, recentRunsResult.value) });
    }

    const recordResult = await this.#store.recordRun(createSourceRun(status.name, now, status.count, status.errors?.[0] ?? null));
    return recordResult.isSuccess ? Result.success(status) : Result.failure(recordResult.statusCode, recordResult.errors);
  }
}

// The same role often appears on both sites (Adzuna also indexes Reed), so match on title + company.
// Without a company (e.g. emagine) a title alone can't identify a role, so such adverts are never merged.
/** @param {import('../models/job.js').Job} job */
function duplicateKey(job) {
  const company = normalise(job.company);
  return company.length === 0
    ? `advert|${job.source}|${job.id}`
    : `role|${normalise(job.title)}|${company}`;
}

// Prefer an advert with a stated (not estimated) rate, then the most recent one.
/** @param {import('../models/job.js').Job[]} duplicates */
function pickBest(duplicates) {
  const noStatedRate = (j) => (j.rateIsEstimated || (j.dayRateMin === null && j.dayRateMax === null) ? 1 : 0);
  return [...duplicates].sort((a, b) => noStatedRate(a) - noStatedRate(b) || postedTime(b) - postedTime(a))[0];
}

// Undated adverts sort last, as with DateTimeOffset.MinValue; a finite sentinel keeps the comparator out of NaN.
const postedTime = (job) => (job.postedAt === null ? Number.MIN_SAFE_INTEGER : job.postedAt.getTime());

// Letters and digits only (Unicode, like char.IsLetterOrDigit), lower-cased.
const NotLetterOrDigit = /[^\p{L}\p{Nd}]/gu;

/** @param {string | null | undefined} value */
function normalise(value) {
  return value ? value.replace(NotLetterOrDigit, '').toLowerCase() : '';
}

