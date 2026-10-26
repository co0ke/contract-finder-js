import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DayRate, roundHalfToEven } from '../../../src/services/sources/dayRate.js';

describe('DayRate', () => {
  for (const [advertised, expected] of [
    [null, null],
    [100, 100],       // lowest plausible day rate
    [2000, 2000],     // highest plausible day rate
    [550.4, 550],     // day rates are rounded
    [26000, 100],     // lowest yearly figure accepted (£100 x 260)
    [143000, 550],    // Adzuna's yearly version of £550/day
    [130000, 500],
    [9100, null],     // junk: too high for a day rate, too low for a year
    [2500, null],
    [60, null],       // probably hourly
  ]) {
    it(`FromAdvertised_DailyYearlyOrImplausibleAmount_ReturnsDayRateOrNull (${advertised})`, () => {
      assert.equal(DayRate.fromAdvertised(advertised), expected);
    });
  }

  it('FromAdvertised_Undefined_ReturnsNull', () => {
    assert.equal(DayRate.fromAdvertised(undefined), null);
  });

  // Math.Round(decimal) in .NET rounds halves to even.
  for (const [value, expected] of [[550.5, 550], [551.5, 552], [550.4, 550], [550.6, 551]]) {
    it(`RoundHalfToEven_${value}_Is${expected}`, () => {
      assert.equal(roundHalfToEven(value), expected);
    });
  }
});
