import { SourceHealthConstants } from '../constants/sourceHealthConstants.js';

/**
 * Spots a source that has probably broken: a changed HTML layout returns 0 adverts rather than an error.
 */
export const SourceHealth = Object.freeze({
  /**
   * @param {number} count
   * @param {Iterable<import('../models/jobSearch.js').SourceRun>} recentRuns The source's runs before this one, newest first.
   * @returns {string | null}
   */
  warning(count, recentRuns) {
    const counts = [...recentRuns]
      .filter((r) => r.error === null || r.error === undefined)
      .slice(0, SourceHealthConstants.RunsToCompare)
      .map((r) => r.count)
      .sort((a, b) => a - b);
    if (counts.length < SourceHealthConstants.MinimumSuccessfulRuns) {
      return null;
    }

    const usual = median(counts);
    return usual >= SourceHealthConstants.MinimumUsualCount && count < usual * SourceHealthConstants.WarnBelowFractionOfUsual
      ? `Returned ${count}, usual is ~${formatWhole(usual)}.`
      : null;
  },
});

/** @param {number[]} sorted */
function median(sorted) {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

// .NET's "0" format rounds halves away from zero, as Math.round does for positive numbers.
const formatWhole = (value) => String(Math.round(value));
