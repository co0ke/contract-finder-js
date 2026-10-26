/**
 * Keeps every advert seen, and each source's run history, between searches.
 * An unreachable store is a `StoreUnavailable` failure rather than an exception.
 *
 * @typedef {object} IJobStore
 * @property {(jobs: ReadonlyArray<import('../../models/job.js').Job>, seenAt: Date) => Promise<import('../../common/result.js').Result<void>>} upsert
 *   Stores adverts, keyed on source + id. A new advert's `firstSeenAt` is `seenAt`; an existing one keeps
 *   its original value but has its other fields refreshed.
 * @property {(since: Date) => Promise<import('../../common/result.js').Result<ReadonlyArray<import('../../models/job.js').Job>>>} query
 *   Adverts posted since `since`, or, when undated, last seen since then.
 * @property {(run: import('../../models/jobSearch.js').SourceRun) => Promise<import('../../common/result.js').Result<void>>} recordRun
 * @property {(source: string, count: number) => Promise<import('../../common/result.js').Result<ReadonlyArray<import('../../models/jobSearch.js').SourceRun>>>} getRecentRuns
 *   The source's most recent runs, newest first.
 * @property {(cutoff: Date) => Promise<import('../../common/result.js').Result<number>>} deleteOlderThan
 *   Deletes adverts last written before `cutoff` (a source that still returns an advert refreshes it on
 *   every collection) and runs recorded before it. Returns how many entries were deleted.
 */
export {};
