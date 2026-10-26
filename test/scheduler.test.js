import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { scheduleDailyUtc } from '../src/scheduler.js';
import { utc } from './testDoubles.js';

describe('scheduleDailyUtc', () => {
  it('Schedule_BeforeTimeToday_RunsToday', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const runs = [];
    const stop = scheduleDailyUtc({ hour: 3, minute: 30 }, async () => { runs.push(1); }, { now: () => utc(2026, 9, 25, 1, 0) });

    mock.timers.tick(2.5 * 60 * 60 * 1000 - 1);
    assert.equal(runs.length, 0);
    mock.timers.tick(1);
    assert.equal(runs.length, 1);

    stop();
    mock.timers.reset();
  });

  it('Schedule_AfterTimeToday_RunsTomorrow', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const runs = [];
    const stop = scheduleDailyUtc({ hour: 3, minute: 30 }, async () => { runs.push(1); }, { now: () => utc(2026, 9, 25, 4, 0) });

    mock.timers.tick(23 * 60 * 60 * 1000);
    assert.equal(runs.length, 0);
    mock.timers.tick(30 * 60 * 1000);
    assert.equal(runs.length, 1);

    stop();
    mock.timers.reset();
  });

  it('Schedule_TaskThrows_LogsAndKeepsGoing', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const errors = [];
    let now = utc(2026, 9, 25, 3, 29);
    const stop = scheduleDailyUtc({ hour: 3, minute: 30 }, async () => { throw new Error('boom'); },
      { now: () => now, logger: { error: (...args) => errors.push(args) } });

    mock.timers.tick(60 * 1000);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(errors.length, 1);
    assert.equal(errors[0][1].message, 'boom');
    stop();
    mock.timers.reset();
  });
});
