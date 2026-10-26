import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { localToUtc, zoneOffsetMs } from '../../../src/services/sources/localTime.js';
import { utc } from '../../testDoubles.js';

const London = 'Europe/London';
const Hour = 60 * 60 * 1000;

describe('localTime', () => {
  for (const [wall, expected, season] of [
    [{ year: 2026, month: 9, day: 22, hour: 17, minute: 6, second: 26 }, utc(2026, 9, 22, 16, 6, 26), 'BST'],
    [{ year: 2026, month: 1, day: 22, hour: 17, minute: 6, second: 26 }, utc(2026, 1, 22, 17, 6, 26), 'GMT'],
    // Clocks go forward at 01:00 UTC on 29 March 2026: 00:30 is still GMT, 02:30 is BST.
    [{ year: 2026, month: 3, day: 29, hour: 0, minute: 30 }, utc(2026, 3, 29, 0, 30), 'before spring forward'],
    [{ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, utc(2026, 3, 29, 1, 30), 'after spring forward'],
    // Clocks go back at 01:00 UTC on 25 October 2026: 00:30 is BST, 02:30 is GMT.
    [{ year: 2026, month: 10, day: 25, hour: 0, minute: 30 }, utc(2026, 10, 24, 23, 30), 'before fall back'],
    [{ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, utc(2026, 10, 25, 2, 30), 'after fall back'],
  ]) {
    it(`LocalToUtc_UkWallClock_AppliesOffsetInForce (${season})`, () => {
      assert.deepEqual(localToUtc(London, wall), expected);
    });
  }

  it('ZoneOffsetMs_SummerAndWinter_IsOneHourAndZero', () => {
    assert.equal(zoneOffsetMs(London, utc(2026, 7, 1).getTime()), Hour);
    assert.equal(zoneOffsetMs(London, utc(2026, 12, 1).getTime()), 0);
  });

  it('LocalToUtc_ZoneEastOfUtc_SubtractsOffset', () => {
    assert.deepEqual(localToUtc('Asia/Tokyo', { year: 2026, month: 1, day: 1, hour: 9 }), utc(2026, 1, 1, 0));
  });
});
