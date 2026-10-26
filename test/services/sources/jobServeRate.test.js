import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JobServeRate } from '../../../src/services/sources/jobServeRate.js';

describe('JobServeRate', () => {
  // Rate strings taken from real JobServe adverts.
  for (const [text, min, max] of [
    ['£450 - £500 per day', 450, 500],
    ['£325/Day', 325, 325],
    ['500/Day', 500, 500],
    ['400.00 Daily - 416.00 Daily GBP', 400, 416],
    ['600.00 - 650.00 GBP/Daily', 600, 650],
    ['£525.00 - £545.00 per day', 525, 545],
    ['600-775 p/d (Outside IR35)', 600, 775],
    ['£550 - £600pd', 550, 600],
    ['Up to £550 p/d Inside IR35', 550, 550],
    ['to £800 per day inside IR35', 800, 800],
    ['c. £725/day outside IR35 DoE', 725, 725],
    ['£545 inside IR35', 545, 545],
    ['£700 - 750 per day', 700, 750],
    ['£55k-60k', 212, 231],
    ['55k - 65k Annual GBP', 212, 250],
    ['£100-120k', 385, 462],
    ['Up to £110k per annum', 423, 423],
    ['£35k - 45k per year + Bonus + Pension + Excellent Benefits', 135, 173],
  ]) {
    it(`Parse_AdvertisedRate_ReturnsDayRates (${text})`, () => {
      assert.deepEqual(JobServeRate.parse(text), { min, max });
    });
  }

  for (const text of [
    null,
    undefined,
    '',
    'GBP',
    'Flexible',
    'competitive (inside IR35)',
    'Competitve dependent on experience via Umbrella Company',
    '25.00 Hourly GBP',
    '£120 per hour',
  ]) {
    it(`Parse_NoUsableDayRate_ReturnsNulls (${JSON.stringify(text)})`, () => {
      assert.deepEqual(JobServeRate.parse(text), { min: null, max: null });
    });
  }

  it('Parse_DurationBeforeRate_IgnoresDuration', () => {
    assert.deepEqual(JobServeRate.parse('6 months, £500 per day'), { min: 500, max: 500 });
  });
});
