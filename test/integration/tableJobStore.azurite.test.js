// Integration tests for the real Table Storage adapter. They need Azurite's table service
// (e.g. `npx azurite-table --location .azurite`) and only run when RUN_AZURITE_TESTS=true.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createError } from '../../src/common/error.js';
import { ErrorCode } from '../../src/common/errorCode.js';
import { createSourceRun } from '../../src/models/jobSearch.js';
import { TableJobStore } from '../../src/services/storage/tableJobStore.js';
import { addDays, addHours, makeJob, utc } from '../testDoubles.js';

const enabled = (process.env.RUN_AZURITE_TESTS ?? '').toLowerCase() === 'true';
const connectionString = process.env.JobStore__ConnectionString ?? 'UseDevelopmentStorage=true';

const Day1 = utc(2026, 9, 21, 9);
const Day2 = addDays(Day1, 1);

// Each test gets its own source (partition), so they don't see each other's rows.
let partition = 0;
const source = () => `it-${process.pid}-${Date.now()}-${partition++}`;

describe('TableJobStore (Azurite)', { skip: enabled ? false : 'Set RUN_AZURITE_TESTS=true with Azurite running.' }, () => {
  const store = new TableJobStore(TableJobStore.createClients(connectionString));

  it('UpsertAsync_ExistingJob_KeepsFirstSeenAtAndRefreshesFields', async () => {
    const s = source();
    await store.upsert([makeJob({ source: s, id: 'a/1', dayRateMin: 500, postedAt: Day1 })], Day1);

    await store.upsert([makeJob({ source: s, id: 'a/1', dayRateMin: 550, postedAt: Day1 })], Day2);

    const jobs = (await store.query(Day1)).value.filter((j) => j.source === s);
    assert.equal(jobs.length, 1);
    assert.deepEqual([jobs[0].id, jobs[0].dayRateMin, jobs[0].firstSeenAt, jobs[0].postedAt], ['a/1', 550, Day1, Day1]);
  });

  it('QueryAsync_UndatedJob_IsListedWhileStillSeen', async () => {
    const s = source();
    await store.upsert([makeJob({ source: s, id: 'undated' })], Day1);
    assert.deepEqual((await store.query(Day1)).value.filter((j) => j.source === s).map((j) => j.id), ['undated']);
    assert.deepEqual((await store.query(addHours(Day1, 1))).value.filter((j) => j.source === s), []);

    await store.upsert([makeJob({ source: s, id: 'undated' })], Day2);

    const job = (await store.query(Day2)).value.find((j) => j.source === s);
    assert.deepEqual([job.id, job.postedAt, job.firstSeenAt], ['undated', null, Day1]);
  });

  it('UpsertAsync_MoreThanOneBatch_StoresEveryJob', async () => {
    const s = source();
    const jobs = Array.from({ length: 250 }, (_, i) => makeJob({ source: s, id: `m${i}`, postedAt: Day1 }));

    const result = await store.upsert(jobs, Day1);

    assert.equal(result.isSuccess, true);
    assert.equal((await store.query(Day1)).value.filter((j) => j.source === s).length, 250);
  });

  it('GetRecentRunsAsync_SeveralRuns_ReturnsNewestFirstWithErrors', async () => {
    const s = source();
    const boom = createError(ErrorCode.SourceHttpError, 'boom');
    for (let i = 0; i < 5; i++) {
      await store.recordRun(createSourceRun(s, addHours(Day1, i), i, i === 2 ? boom : null));
    }

    const runs = (await store.getRecentRuns(s, 3)).value;

    assert.deepEqual(runs, [
      createSourceRun(s, addHours(Day1, 4), 4, null),
      createSourceRun(s, addHours(Day1, 3), 3, null),
      createSourceRun(s, addHours(Day1, 2), 2, boom),
    ]);
  });

  it('DeleteOlderThanAsync_RunsBeforeCutoff_DeletesAndCountsThem', async () => {
    const s = source();
    await store.recordRun(createSourceRun(s, Day1, 1, null));
    await store.recordRun(createSourceRun(s, Day2, 2, null));

    // Jobs are deleted by write time, which is "now" for anything this test wrote; only count runs here.
    const before = (await store.getRecentRuns(s, 10)).value.length;
    const deleted = (await store.deleteOlderThan(Day2)).value;
    const after = (await store.getRecentRuns(s, 10)).value;

    assert.equal(before, 2);
    assert.ok(deleted >= 1);
    assert.deepEqual(after.map((r) => r.count), [2]);
  });
});
