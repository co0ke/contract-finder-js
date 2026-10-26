const WorkingDaysPerYear = 260;

// Plausible day rates for a contract role.
const MinDaily = 100;
const MaxDaily = 2_000;

export const DayRateConstants = Object.freeze({
  WorkingDaysPerYear,
  MinDaily,
  MaxDaily,

  // A yearly figure below this works out under MinDaily, so it's treated as noise.
  MinAnnual: MinDaily * WorkingDaysPerYear,
});
