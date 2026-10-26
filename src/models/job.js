/**
 * How an advert fares against the relevance rules. Serialised by name.
 * @readonly
 * @enum {string}
 */
export const Relevance = Object.freeze({
  /** Mentions .NET, C# or Azure: always in. */
  StackMatch: 'StackMatch',

  /** A software role that names no stack: in. */
  Generic: 'Generic',

  /** Names another stack (Java, Python...): out unless the advert says it's open to other backgrounds. */
  OtherStack: 'OtherStack',

  /** Not a software development role (e.g. a network engineer matched on "net"): out. */
  Unrelated: 'Unrelated',
});

/**
 * A job advert normalised from any source.
 * @typedef {object} Job
 * @property {string} source
 * @property {string} id
 * @property {string} title
 * @property {string | null} company
 * @property {string | null} location
 * @property {number | null} dayRateMin Estimated day rate; yearly figures are converted (see `DayRate`), implausible ones are null.
 * @property {number | null} dayRateMax
 * @property {boolean} rateIsEstimated True when the source guessed the rate rather than the advert stating it.
 * @property {Date | null} postedAt
 * @property {string} url
 * @property {string | null} snippet
 * @property {Date | null} firstSeenAt When a search first returned this advert. Set by the job store.
 * @property {boolean} isNew True when this advert was first seen by the current search.
 * @property {keyof typeof Relevance | null} relevance Why the advert is (or isn't) relevant. Set by the search service.
 */

/**
 * Makes a Job with every field present, as the C# record would be. Required fields throw when missing so
 * a mapping bug can't produce a half-built advert. Use `{ ...job, isNew: true }` for a C# `with` expression.
 * @param {Partial<Job> & Pick<Job, 'source' | 'id' | 'title' | 'url'>} fields
 * @returns {Job}
 */
export function createJob(fields) {
  for (const required of ['source', 'id', 'title', 'url']) {
    if (typeof fields[required] !== 'string') {
      throw new TypeError(`A job needs a ${required}.`);
    }
  }
  return Object.freeze({
    source: fields.source,
    id: fields.id,
    title: fields.title,
    company: fields.company ?? null,
    location: fields.location ?? null,
    dayRateMin: fields.dayRateMin ?? null,
    dayRateMax: fields.dayRateMax ?? null,
    rateIsEstimated: fields.rateIsEstimated ?? false,
    postedAt: fields.postedAt ?? null,
    url: fields.url,
    snippet: fields.snippet ?? null,
    firstSeenAt: fields.firstSeenAt ?? null,
    isNew: fields.isNew ?? false,
    relevance: fields.relevance ?? null,
  });
}
