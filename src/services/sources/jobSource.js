/**
 * @typedef {object} IJobSource
 * @property {string} name
 * @property {(query: import('../../models/jobSearch.js').JobSearchQuery) => Promise<import('../../common/result.js').Result<ReadonlyArray<import('../../models/job.js').Job>>>} search
 *   A failure for anything the site can be expected to do wrong: an error status, no response, a timeout,
 *   missing credentials or blocking. Unparseable responses still throw.
 */
export {};
