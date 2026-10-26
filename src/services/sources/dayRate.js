import { DayRateConstants } from '../../constants/dayRateConstants.js';

/**
 * Normalises a pay figure from a job advert to an estimated day rate.
 * Sources mix conventions: Adzuna annualises contract rates (£550/day becomes ~£143,000),
 * and some adverts are simply wrong, so anything that isn't clearly one or the other is dropped.
 */
export const DayRate = Object.freeze({
  /**
   * @param {number | null | undefined} amount
   * @returns {number | null}
   */
  fromAdvertised(amount) {
    if (amount === null || amount === undefined || Number.isNaN(amount)) {
      return null;
    }
    if (amount >= DayRateConstants.MinDaily && amount <= DayRateConstants.MaxDaily) {
      return roundHalfToEven(amount);
    }
    if (amount >= DayRateConstants.MinAnnual) {
      return roundHalfToEven(amount / DayRateConstants.WorkingDaysPerYear);
    }
    // Hourly, monthly or junk values (e.g. £9,100 for a London contract) can't be told apart.
    return null;
  },
});

/** .NET's Math.Round(decimal) rounds halves to the even neighbour; Math.round would round them up. */
export function roundHalfToEven(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction < 0.5) {
    return floor;
  }
  if (fraction > 0.5) {
    return floor + 1;
  }
  return floor % 2 === 0 ? floor : floor + 1;
}
