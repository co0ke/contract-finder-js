import { DayRate } from './dayRate.js';

const Ir35 = /IR\s?35/gi;
const Hourly = /hour|\bp\/?h\b|\d\s*ph\b|\/hr\b/i;
const Amount = /(?<value>\d[\d,]*(?:\.\d+)?)(?<k>k)?/gi;
const RangeSeparator = /^\s*(?:-|–|to)\s*£?\s*$/i;

/**
 * Reads a day rate from JobServe's free-text rate field, e.g. "£450 - £500 per day + Inside IR35",
 * "400.00 Daily - 416.00 Daily GBP" or "£100-120k".
 */
export const JobServeRate = Object.freeze({
  /**
   * @param {string | null | undefined} text
   * @returns {{ min: number | null, max: number | null }}
   */
  parse(text) {
    if (!text || text.trim().length === 0) {
      return { min: null, max: null };
    }

    // "IR35" would otherwise read as a figure of 35.
    text = text.replace(Ir35, ' ');

    // An hourly figure such as £120/hour would pass as a day rate.
    if (Hourly.test(text)) {
      return { min: null, max: null };
    }

    const matches = [...text.matchAll(Amount)];
    const amounts = matches.map((match, i) => {
      let value = Number(match.groups.value.replaceAll(',', ''));
      if (match.groups.k !== undefined || thousandsFromRange(text, matches, i, value)) {
        value *= 1000;
      }
      return value;
    });

    // Skip figures that aren't pay, e.g. the 6 in "6 months, £500 per day".
    const rates = amounts.map((a) => DayRate.fromAdvertised(a)).filter((r) => r !== null).slice(0, 2);
    switch (rates.length) {
      case 0: return { min: null, max: null };
      case 1: return { min: rates[0], max: rates[0] };
      default: return { min: rates[0], max: rates[1] };
    }
  },
});

// In "£100-120k" the "k" applies to both ends of the range.
function thousandsFromRange(text, matches, i, value) {
  if (value >= 1000 || i + 1 >= matches.length || matches[i + 1].groups.k === undefined) {
    return false;
  }
  const gapStart = matches[i].index + matches[i][0].length;
  return RangeSeparator.test(text.slice(gapStart, matches[i + 1].index));
}
