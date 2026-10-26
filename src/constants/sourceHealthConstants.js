export const SourceHealthConstants = Object.freeze({
  /** How many recent runs to fetch: enough to find `RunsToCompare` successful ones despite failures. */
  RunsToFetch: 30,

  /** How many recent successful runs judge what's usual. */
  RunsToCompare: 10,

  // Too few runs, or too few adverts per run, and a low count is just a quiet day.
  MinimumSuccessfulRuns: 3,
  MinimumUsualCount: 5,
  WarnBelowFractionOfUsual: 0.25,
});
