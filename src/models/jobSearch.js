const MsPerDay = 24 * 60 * 60 * 1000;

/** A search across the whole UK. Each source decides how to combine the keywords. */
export class JobSearchQuery {
  /**
   * @param {ReadonlyArray<string>} keywords
   * @param {number} maxDaysOld
   */
  constructor(keywords, maxDaysOld) {
    this.keywords = Object.freeze([...keywords]);
    this.maxDaysOld = maxDaysOld;
    Object.freeze(this);
  }

  /**
   * The oldest posted time to keep: whole UTC days back from the start of today.
   * Worked out in UTC, so the server's local offset never leaks into the cutoff.
   * @param {Date} now
   * @returns {Date}
   */
  postedSince(now) {
    const startOfToday = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return new Date(startOfToday - this.maxDaysOld * MsPerDay);
  }
}

/** One source's outcome in one collection. */
export class SourceStatus {
  /**
   * @param {string} name
   * @param {number} count
   * @param {object} [details]
   * @param {string | null} [details.warning] Set when the source returned far fewer adverts than it usually does.
   * @param {number | null} [details.upstreamStatus] When the source failed: the site's HTTP status, or 500 when it gave none.
   * @param {ReadonlyArray<import('../common/error.js').AppError> | null} [details.errors] When the source failed: what went wrong. Null when it succeeded.
   */
  constructor(name, count, { warning = null, upstreamStatus = null, errors = null } = {}) {
    this.name = name;
    this.count = count;
    this.warning = warning;
    this.upstreamStatus = upstreamStatus;
    this.errors = errors === null ? null : Object.freeze([...errors]);
    Object.freeze(this);
  }

  /** Not serialised: a getter on the prototype, like the C# `[JsonIgnore]` property. */
  get failed() {
    return this.errors !== null && this.errors.length > 0;
  }

  /** A copy with some fields changed, like a C# `with` expression. */
  with({ warning = this.warning, upstreamStatus = this.upstreamStatus, errors = this.errors } = {}) {
    return new SourceStatus(this.name, this.count, { warning, upstreamStatus, errors });
  }
}

/**
 * One source's outcome in one search, kept as history to judge what's normal for it.
 * @typedef {object} SourceRun
 * @property {string} source
 * @property {Date} at
 * @property {number} count
 * @property {import('../common/error.js').AppError | null} error The first error when the source failed.
 */

/**
 * @param {string} source
 * @param {Date} at
 * @param {number} count
 * @param {import('../common/error.js').AppError | null} [error]
 * @returns {SourceRun}
 */
export const createSourceRun = (source, at, count, error = null) => Object.freeze({ source, at, count, error });

/**
 * What one collection did: when it ran, and how each source fared.
 * @typedef {object} JobCollection
 * @property {Date} at When the adverts were stored, which is what marks an advert as new.
 * @property {ReadonlyArray<SourceStatus>} sources
 */

/**
 * @param {Date} at
 * @param {ReadonlyArray<SourceStatus>} sources
 * @returns {JobCollection}
 */
export const createJobCollection = (at, sources) => Object.freeze({ at, sources: Object.freeze([...sources]) });

/** The body of a successful /api/jobs response. */
export class JobSearchResult {
  /**
   * @param {ReadonlyArray<string>} keywords What was searched, so the UI can show the defaults when none were given.
   * @param {ReadonlyArray<SourceStatus>} sources
   * @param {ReadonlyArray<import('./job.js').Job>} jobs
   */
  constructor(keywords, sources, jobs) {
    this.keywords = Object.freeze([...keywords]);
    this.sources = Object.freeze([...sources]);
    this.jobs = Object.freeze([...jobs]);
    Object.freeze(this);
  }

  get count() {
    return this.jobs.length;
  }

  /** Serialised like the C# record: `count` is a property, `failed` on each source isn't. */
  toJSON() {
    return { keywords: this.keywords, sources: this.sources, jobs: this.jobs, count: this.count };
  }
}
