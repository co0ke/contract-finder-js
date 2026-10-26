import { Result } from '../../common/result.js';

/**
 * Behaves like the Table Storage store, in memory: the mock used when running without Azure and in tests.
 * State lives for the process, so "new since the last search" works across requests to one server.
 * @implements {import('./jobStore.js').IJobStore}
 */
export class InMemoryJobStore {
  /** @type {Map<string, { job: import('../../models/job.js').Job, lastSeenAt: Date }>} */
  #jobs = new Map();

  /** Every recorded run, oldest first. Exposed so tests can seed and inspect history. */
  /** @type {import('../../models/jobSearch.js').SourceRun[]} */
  runs = [];

  /**
   * @param {ReadonlyArray<import('../../models/job.js').Job>} jobs
   * @param {Date} seenAt
   */
  async upsert(jobs, seenAt) {
    for (const job of jobs) {
      const key = keyOf(job.source, job.id);
      const existing = this.#jobs.get(key);
      const firstSeenAt = existing ? existing.job.firstSeenAt : seenAt;
      this.#jobs.set(key, { job: Object.freeze({ ...job, firstSeenAt }), lastSeenAt: seenAt });
    }
    return Result.success();
  }

  /** @param {Date} since */
  async query(since) {
    return Result.success([...this.#jobs.values()]
      .filter(({ job, lastSeenAt }) => (job.postedAt ?? lastSeenAt).getTime() >= since.getTime())
      .map(({ job }) => job));
  }

  /** @param {import('../../models/jobSearch.js').SourceRun} run */
  async recordRun(run) {
    this.runs.push(run);
    return Result.success();
  }

  /** @param {Date} cutoff */
  async deleteOlderThan(cutoff) {
    const expiredJobs = [...this.#jobs].filter(([, entry]) => entry.lastSeenAt.getTime() < cutoff.getTime()).map(([key]) => key);
    for (const key of expiredJobs) {
      this.#jobs.delete(key);
    }
    const before = this.runs.length;
    this.runs = this.runs.filter((r) => r.at.getTime() >= cutoff.getTime());
    return Result.success(expiredJobs.length + (before - this.runs.length));
  }

  /** @param {string} source @param {number} count */
  async getRecentRuns(source, count) {
    return Result.success(this.runs
      .filter((r) => r.source === source)
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, count));
  }
}

const keyOf = (source, id) => `${source}\u0000${id}`;
