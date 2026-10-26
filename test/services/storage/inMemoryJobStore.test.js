import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createSourceRun } from '../../../src/models/jobSearch.js';
import { InMemoryJobStore } from '../../../src/services/storage/inMemoryJobStore.js';
import { addDays, makeJob, single, utc } from '../../testDoubles.js';

const Day1 = utc(2026, 9, 21);
const Day2 = addDays(Day1, 1);

describe('InMemoryJobStore', () => {
  it('UpsertAsync_NewJob_SetsFirstSeenAt', async () => {
    const store = new InMemoryJobStore();

    await store.upsert([makeJob()], Day1);

    assert.deepEqual(single((await store.query(Day1)).value).firstSeenAt, Day1);
  });

  it('UpsertAsync_ExistingJob_KeepsFirstSeenAtAndRefreshesFields', async () => {
    const store = new InMemoryJobStore();
    await store.upsert([makeJob({ dayRateMin: 500 })], Day1);

    await store.upsert([makeJob({ dayRateMin: 550 })], Day2);

    const job = single((await store.query(Day1)).value);
    assert.deepEqual([job.firstSeenAt, job.dayRateMin], [Day1, 550]);
  });

  it('UpsertAsync_SameIdFromDifferentSources_StoresBoth', async () => {
    const store = new InMemoryJobStore();

    await store.upsert([makeJob({ source: 'A', id: '1' }), makeJob({ source: 'B', id: '1' })], Day1);

    assert.equal((await store.query(Day1)).value.length, 2);
  });

  it('QueryAsync_UndatedJob_IsListedByLastSeenTime', async () => {
    const store = new InMemoryJobStore();
    await store.upsert([makeJob({ id: 'old' })], Day1);
    await store.upsert([makeJob({ id: 'recent' })], Day2);

    const jobs = (await store.query(Day2)).value;

    assert.deepEqual(jobs.map((j) => j.id), ['recent']);
  });

  it('GetRecentRunsAsync_ManyRuns_ReturnsNewestFirstUpToCount', async () => {
    const store = new InMemoryJobStore();
    for (const day of [1, 3, 2]) {
      await store.recordRun(createSourceRun('A', addDays(Day1, day), day, null));
    }
    await store.recordRun(createSourceRun('B', addDays(Day1, 9), 9, null));

    const runs = (await store.getRecentRuns('A', 2)).value;

    assert.deepEqual(runs.map((r) => r.count), [3, 2]);
  });

  it('DeleteOlderThanAsync_Cutoff_CountsJobsAndRuns', async () => {
    const store = new InMemoryJobStore();
    await store.upsert([makeJob({ id: 'old' })], Day1);
    await store.upsert([makeJob({ id: 'recent' })], Day2);
    await store.recordRun(createSourceRun('A', Day1, 1, null));
    await store.recordRun(createSourceRun('A', Day2, 1, null));

    const deleted = (await store.deleteOlderThan(Day2)).value;

    assert.equal(deleted, 2);
    assert.deepEqual((await store.query(Day1)).value.map((j) => j.id), ['recent']);
    assert.equal(store.runs.length, 1);
  });
});
