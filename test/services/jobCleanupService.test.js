import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode } from '../../src/common/errorCode.js';
import { createSourceRun } from '../../src/models/jobSearch.js';
import { JobCleanupService } from '../../src/services/jobCleanupService.js';
import { InMemoryJobStore, UnavailableJobStore, addDays, fixedTime, makeJob, utc } from '../testDoubles.js';

const Now = utc(2026, 9, 30, 12, 0, 0);

describe('JobCleanupService', () => {
  it('CleanUpAsync_AdvertsNotSeenForThreeWeeks_DeletesOnlyThose', async () => {
    const store = new InMemoryJobStore();
    await store.upsert([makeJob({ id: 'old' })], addDays(Now, -22));
    await store.upsert([makeJob({ id: 'recent' })], addDays(Now, -20));

    const result = await new JobCleanupService(store, fixedTime(Now)).cleanUp();

    assert.equal(result.value, 1);
    const remaining = (await store.query(addDays(Now, -60))).value;
    assert.deepEqual(remaining.map((j) => j.id), ['recent']);
  });

  it('CleanUpAsync_AdvertPostedLongAgoButSeenRecently_IsKept', async () => {
    const store = new InMemoryJobStore();
    await store.upsert([makeJob({ postedAt: addDays(Now, -40) })], addDays(Now, -1));

    const result = await new JobCleanupService(store, fixedTime(Now)).cleanUp();

    assert.equal(result.value, 0);
  });

  it('CleanUpAsync_OldRuns_DeletesThem', async () => {
    const store = new InMemoryJobStore();
    await store.recordRun(createSourceRun('Test', addDays(Now, -22), 5, null));
    await store.recordRun(createSourceRun('Test', addDays(Now, -1), 5, null));

    const result = await new JobCleanupService(store, fixedTime(Now)).cleanUp();

    assert.equal(result.value, 1);
    assert.equal(store.runs.length, 1);
  });

  it('CleanUpAsync_StoreUnavailable_ReturnsStoreUnavailable', async () => {
    const result = await new JobCleanupService(new UnavailableJobStore(), fixedTime(Now)).cleanUp();

    assert.equal(result.isSuccess, false);
    assert.equal(result.errors[0].code, ErrorCode.StoreUnavailable);
  });
});
