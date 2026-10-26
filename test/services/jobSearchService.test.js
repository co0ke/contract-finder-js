import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createError } from '../../src/common/error.js';
import { ErrorCode } from '../../src/common/errorCode.js';
import { Relevance } from '../../src/models/job.js';
import { JobSearchQuery, SourceStatus, createSourceRun } from '../../src/models/jobSearch.js';
import { JobSearchService } from '../../src/services/jobSearchService.js';
import { nullLogger } from '../../src/services/logger.js';
import {
  FakeJobSource, InMemoryJobStore, UnavailableJobStore, addDays, addHours, fixedTime, makeJob, single, utc,
} from '../testDoubles.js';

const Query = new JobSearchQuery(['.NET'], 7);
const Day1 = utc(2026, 9, 21);
const Day2 = addDays(Day1, 1);
const Day3 = addDays(Day1, 2);
const Now = addHours(Day3, 33);
const Boom = createError(ErrorCode.SourceHttpError, 'Broken returned 401 Unauthorized.');

const createWith = (store, now, ...sources) => new JobSearchService(sources, store, fixedTime(now), nullLogger);
const create = (...sources) => createWith(new InMemoryJobStore(), Now, ...sources);

const collectAndStore = async (service) => (await service.collectAndStore(Query)).value;

// Collects then lists, as GetJobs does.
async function collectAndList(service) {
  const collection = await collectAndStore(service);
  return (await service.list(Query, collection.at)).value;
}

const range = (start, count) => Array.from({ length: count }, (_, i) => start + i);

describe('JobSearchService', () => {
  // Collecting

  it('CollectAndStoreAsync_MultipleSources_PassesQueryToEach', async () => {
    const a = new FakeJobSource('A', () => []);
    const b = new FakeJobSource('B', () => []);

    await create(a, b).collectAndStore(Query);

    assert.equal(a.lastQuery, Query);
    assert.equal(b.lastQuery, Query);
  });

  it('CollectAndStoreAsync_MultipleSources_ReportsCountPerSourceAndTime', async () => {
    const a = new FakeJobSource('A', () => [makeJob({ source: 'A', id: '1' }), makeJob({ source: 'A', id: '2' })]);
    const b = new FakeJobSource('B', () => [makeJob({ source: 'B', id: '3' })]);

    const collection = await collectAndStore(create(a, b));

    assert.deepEqual(collection.at, Now);
    assert.deepEqual(collection.sources, [new SourceStatus('A', 2), new SourceStatus('B', 1)]);
  });

  it('CollectAndStoreAsync_SourceReturnsFailure_ReportsErrorsAndUpstreamStatus', async () => {
    const broken = FakeJobSource.failing('Broken', 401, Boom);
    const working = new FakeJobSource('Working', () => [makeJob({ source: 'Working' })]);
    const service = create(broken, working);

    const collection = await collectAndStore(service);

    const status = collection.sources[0];
    assert.deepEqual([status.name, status.count, status.upstreamStatus], ['Broken', 0, 401]);
    assert.deepEqual(status.errors, [Boom]);
    assert.deepEqual(collection.sources[1], new SourceStatus('Working', 1));
    const jobs = (await service.list(Query, collection.at)).value;
    assert.equal(single(jobs).source, 'Working');
  });

  it('CollectAndStoreAsync_SourceThrows_ReportsUnexpectedWithGenericMessage', async () => {
    const broken = new FakeJobSource('Broken', () => { throw new SyntaxError("Unexpected token '<', \"<html>\" is not valid JSON"); });
    const working = new FakeJobSource('Working', () => [makeJob({ source: 'Working' })]);
    const service = create(broken, working);

    const collection = await collectAndStore(service);

    const status = collection.sources[0];
    assert.equal(status.upstreamStatus, 500);
    assert.deepEqual(status.errors, [createError(ErrorCode.SourceUnexpected, 'Unexpected error searching Broken.')]);
    const jobs = (await service.list(Query, collection.at)).value;
    assert.equal(single(jobs).source, 'Working');
  });

  it('CollectAndStoreAsync_StoreUnavailable_ReturnsStoreUnavailable', async () => {
    const source = new FakeJobSource('A', () => [makeJob({ source: 'A' })]);

    const result = await createWith(new UnavailableJobStore(), Now, source).collectAndStore(Query);

    assert.equal(result.isSuccess, false);
    assert.deepEqual(result.errors, [UnavailableJobStore.Unavailable]);
  });

  it('CollectAndStoreAsync_UpsertFails_ReturnsFailure', async () => {
    const source = new FakeJobSource('A', () => [makeJob({ source: 'A' })]);

    const result = await createWith(new UnavailableJobStore(true), Now, source).collectAndStore(Query);

    assert.equal(result.isSuccess, false);
    assert.deepEqual(result.errors, [UnavailableJobStore.Unavailable]);
  });

  // Listing

  it('ListAsync_AnyQuery_DoesNotSearchSources', async () => {
    const source = new FakeJobSource('A', () => [makeJob({ source: 'A' })]);
    const store = new InMemoryJobStore();

    await createWith(store, Now, source).list(Query, Now);

    assert.equal(source.lastQuery, null);
    assert.deepEqual(store.runs, []);
  });

  it('ListAsync_StoreUnavailable_ReturnsStoreUnavailable', async () => {
    const result = await createWith(new UnavailableJobStore(), Now).list(Query, Now);

    assert.equal(result.isSuccess, false);
    assert.deepEqual(result.errors, [UnavailableJobStore.Unavailable]);
  });

  it('ListAsync_MultipleSources_MergesNewestFirstWithUndatedLast', async () => {
    const a = new FakeJobSource('A', () => [
      makeJob({ source: 'A', id: '1', title: '.NET Old', postedAt: Day1 }),
      makeJob({ source: 'A', id: '2', title: '.NET New', postedAt: Day3 }),
    ]);
    const b = new FakeJobSource('B', () => [
      makeJob({ source: 'B', id: '3', title: '.NET Middle', postedAt: Day2 }),
      makeJob({ source: 'B', id: '4', title: '.NET Undated' }),
    ]);

    const jobs = await collectAndList(create(a, b));

    assert.deepEqual(jobs.map((j) => j.title), ['.NET New', '.NET Middle', '.NET Old', '.NET Undated']);
  });

  for (const [titleA, companyA, titleB, companyB] of [
    ['.NET Developer', 'Acme Ltd', '.net developer', 'ACME LTD'],
    ['Senior C# / .NET Engineer', 'Acme', 'Senior C# .NET Engineer', 'Acme'],
  ]) {
    it(`ListAsync_TitleAndCompanyDifferInCaseOrPunctuation_RemovesDuplicate (${titleB} @ ${companyB})`, async () => {
      const a = new FakeJobSource('A', () => [makeJob({ source: 'A', title: titleA, company: companyA })]);
      const b = new FakeJobSource('B', () => [makeJob({ source: 'B', title: titleB, company: companyB })]);

      const jobs = await collectAndList(create(a, b));

      assert.equal(jobs.length, 1);
    });
  }

  it('ListAsync_SameTitleAtDifferentCompanies_KeepsBoth', async () => {
    const a = new FakeJobSource('A', () => [makeJob({ source: 'A', company: 'Acme' })]);
    const b = new FakeJobSource('B', () => [makeJob({ source: 'B', company: 'Globex' })]);

    const jobs = await collectAndList(create(a, b));

    assert.equal(jobs.length, 2);
  });

  for (const company of [null, '']) {
    it(`ListAsync_SameTitleWithNoCompany_KeepsBoth (${JSON.stringify(company)})`, async () => {
      const source = new FakeJobSource('emagine', () => [
        makeJob({ source: 'emagine', id: '1', company }),
        makeJob({ source: 'emagine', id: '2', company }),
      ]);

      const jobs = await collectAndList(create(source));

      assert.deepEqual(jobs.map((j) => j.id).sort(), ['1', '2']);
    });
  }

  it('ListAsync_DuplicatesWithStatedEstimatedAndMissingRates_KeepsStatedRate', async () => {
    const estimated = new FakeJobSource('Estimated', () => [makeJob({ source: 'Estimated', dayRateMin: 400, estimated: true, postedAt: Day3 })]);
    const missing = new FakeJobSource('Missing', () => [makeJob({ source: 'Missing', postedAt: Day3 })]);
    const stated = new FakeJobSource('Stated', () => [makeJob({ source: 'Stated', dayRateMin: 550, postedAt: Day1 })]);

    const jobs = await collectAndList(create(estimated, missing, stated));

    assert.equal(single(jobs).source, 'Stated');
  });

  it('ListAsync_DuplicatesWithEqualRates_KeepsNewest', async () => {
    const older = new FakeJobSource('Older', () => [makeJob({ source: 'Older', dayRateMin: 500, postedAt: Day1 })]);
    const newer = new FakeJobSource('Newer', () => [makeJob({ source: 'Newer', dayRateMin: 500, postedAt: Day2 })]);

    const jobs = await collectAndList(create(older, newer));

    assert.equal(single(jobs).source, 'Newer');
  });

  // Storage

  it('ListAsync_FirstSeenJob_IsNewWithFirstSeenAtNow', async () => {
    const source = new FakeJobSource('A', () => [makeJob({ source: 'A', postedAt: Day3 })]);

    const jobs = await collectAndList(create(source));

    const expected = { ...makeJob({ source: 'A', postedAt: Day3 }), firstSeenAt: Now, isNew: true, relevance: Relevance.StackMatch };
    assert.deepEqual(single(jobs), expected);
  });

  it('ListAsync_JobSeenInEarlierRun_KeepsFirstSeenAtAndIsNotNew', async () => {
    const store = new InMemoryJobStore();
    const source = new FakeJobSource('A', () => [makeJob({ source: 'A', postedAt: Day3 })]);
    await collectAndStore(createWith(store, addHours(Now, -2), source));

    const jobs = await collectAndList(createWith(store, Now, source));

    const expected = { ...makeJob({ source: 'A', postedAt: Day3 }), firstSeenAt: addHours(Now, -2), isNew: false, relevance: Relevance.StackMatch };
    assert.deepEqual(single(jobs), expected);
  });

  it('ListAsync_JobSeenInEarlierRun_RefreshesItsDetails', async () => {
    const store = new InMemoryJobStore();
    await collectAndStore(createWith(store, addHours(Now, -2), new FakeJobSource('A', () => [makeJob({ source: 'A', dayRateMin: 500, postedAt: Day3 })])));

    const jobs = await collectAndList(createWith(store, Now, new FakeJobSource('A', () => [makeJob({ source: 'A', dayRateMin: 550, postedAt: Day3 })])));

    assert.equal(single(jobs).dayRateMin, 550);
  });

  it('ListAsync_JobStoredEarlierButNotReturnedNow_IsStillListed', async () => {
    const store = new InMemoryJobStore();
    await collectAndStore(createWith(store, addHours(Now, -2), new FakeJobSource('A', () => [makeJob({ source: 'A', id: '1', title: '.NET Developer', postedAt: Day3 })])));

    const jobs = await collectAndList(createWith(store, Now, new FakeJobSource('A', () => [makeJob({ source: 'A', id: '2', title: 'C# Developer', postedAt: Day3 })])));

    const byId = [...jobs].sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(byId.map((j) => j.id), ['1', '2']);
    assert.deepEqual(byId.map((j) => j.isNew), [false, true]);
  });

  it('ListAsync_StoredJobsOutsideMaxDaysOld_AreNotListed', async () => {
    // Now is 24 Sep, so 7 days back from the start of today is 17 Sep.
    const store = new InMemoryJobStore();
    const old = utc(2026, 9, 16, 23, 0, 0);
    await collectAndStore(createWith(store, old, new FakeJobSource('A', () => [
      makeJob({ source: 'A', id: 'posted-long-ago', postedAt: old }),
      makeJob({ source: 'A', id: 'undated-last-seen-long-ago' }),
    ])));

    const jobs = await collectAndList(createWith(store, Now, new FakeJobSource('A', () => [
      makeJob({ source: 'A', id: 'posted-at-cutoff', postedAt: utc(2026, 9, 17, 0, 0, 0) }),
    ])));

    assert.equal(single(jobs).id, 'posted-at-cutoff');
  });

  it('ListAsync_UndatedJobStillReturned_StaysListed', async () => {
    const store = new InMemoryJobStore();
    const source = new FakeJobSource('emagine', () => [makeJob({ source: 'emagine', company: null })]);
    await collectAndStore(createWith(store, addDays(Now, -30), source));

    const jobs = await collectAndList(createWith(store, Now, source));

    assert.deepEqual(single(jobs).firstSeenAt, addDays(Now, -30));
  });

  // Run history

  it('CollectAndStoreAsync_AnySearch_RecordsRunPerSource', async () => {
    const store = new InMemoryJobStore();
    const working = new FakeJobSource('Working', () => [makeJob({ source: 'Working' })]);
    const broken = FakeJobSource.failing('Broken', 401, Boom, createError(ErrorCode.SourceTimeout, 'Second.'));

    await collectAndStore(createWith(store, Now, working, broken));

    assert.deepEqual(store.runs, [createSourceRun('Working', Now, 1, null), createSourceRun('Broken', Now, 0, Boom)]);
  });

  for (const [history, count, warning] of [
    [[30, 30, 30], 0, 'Returned 0, usual is ~30.'],
    [[20, 30, 40], 7, 'Returned 7, usual is ~30.'],
    [[20, 30, 40, 50], 8, 'Returned 8, usual is ~35.'],
    [[30, 30, 30], 8, null],
    [[30, 30], 0, null],
    [[4, 4, 4], 0, null],
  ]) {
    it(`CollectAndStoreAsync_CountComparedWithHistory_WarnsWhenFarBelowUsual ([${history}] then ${count})`, async () => {
      const store = new InMemoryJobStore();
      history.forEach((h, i) => store.runs.push(createSourceRun('A', addDays(Now, -i - 1), h, null)));
      const source = new FakeJobSource('A', () => range(1, count).map((n) => makeJob({ source: 'A', id: String(n) })));

      const collection = await collectAndStore(createWith(store, Now, source));

      assert.equal(single(collection.sources).warning, warning);
    });
  }

  it('CollectAndStoreAsync_HistoryIncludesFailedRuns_IgnoresThem', async () => {
    const store = new InMemoryJobStore();
    store.runs.push(
      createSourceRun('A', addDays(Now, -1), 0, Boom),
      createSourceRun('A', addDays(Now, -2), 30, null),
      createSourceRun('A', addDays(Now, -3), 30, null),
      createSourceRun('A', addDays(Now, -4), 30, null),
    );

    const collection = await collectAndStore(createWith(store, Now, new FakeJobSource('A', () => [])));

    assert.equal(single(collection.sources).warning, 'Returned 0, usual is ~30.');
  });

  it('CollectAndStoreAsync_ManyRecentFailures_ComparesWithTenMostRecentSuccessfulRuns', async () => {
    const store = new InMemoryJobStore();
    store.runs.push(...range(1, 5).map((i) => createSourceRun('A', addDays(Now, -i), 0, Boom)));
    store.runs.push(...range(6, 10).map((i) => createSourceRun('A', addDays(Now, -i), 30, null)));
    store.runs.push(...range(16, 10).map((i) => createSourceRun('A', addDays(Now, -i), 2, null)));

    const collection = await collectAndStore(createWith(store, Now, new FakeJobSource('A', () => [])));

    assert.equal(single(collection.sources).warning, 'Returned 0, usual is ~30.');
  });

  it('CollectAndStoreAsync_OnlyOldRunsWereNormal_UsesTenMostRecent', async () => {
    const store = new InMemoryJobStore();
    store.runs.push(...range(1, 10).map((i) => createSourceRun('A', addDays(Now, -i), 2, null)));
    store.runs.push(...range(11, 10).map((i) => createSourceRun('A', addDays(Now, -i), 30, null)));

    const collection = await collectAndStore(createWith(store, Now, new FakeJobSource('A', () => [])));

    assert.equal(single(collection.sources).warning, null);
  });

  it('CollectAndStoreAsync_SourceFailsAfterNormalHistory_ReportsErrorWithoutWarning', async () => {
    const store = new InMemoryJobStore();
    store.runs.push(...range(1, 3).map((i) => createSourceRun('A', addDays(Now, -i), 30, null)));
    const source = FakeJobSource.failing('A', 401, Boom);

    const collection = await collectAndStore(createWith(store, Now, source));

    const status = single(collection.sources);
    assert.equal(status.failed, true);
    assert.equal(status.warning, null);
  });

  // Relevance rules

  for (const [title, snippet, relevance] of [
    ['.NET Developer', null, Relevance.StackMatch],
    ['Senior C# Engineer', null, Relevance.StackMatch],
    ['VB.NET / ASP.NET Developer', null, Relevance.StackMatch],
    ['Dotnet Engineer', null, Relevance.StackMatch],
    ['Azure Platform Engineer', null, Relevance.StackMatch],
    ['Software Engineer', 'Greenfield services in C# on Azure.', Relevance.StackMatch],
    ['Java Developer', 'Java 21 and Spring. Some Azure exposure helpful.', Relevance.StackMatch],
    ['Backend Engineer', 'Build APIs for our payments platform.', Relevance.Generic],
    ['Software Developer', null, Relevance.Generic],
    ['Full-Stack Developer', null, Relevance.Generic],
  ]) {
    it(`ListAsync_AdvertIsRelevant_ListsItWithReason (${title})`, async () => {
      const source = new FakeJobSource('A', () => [makeJob({ source: 'A', title, snippet })]);

      const jobs = await collectAndList(create(source));

      assert.equal(single(jobs).relevance, relevance);
    });
  }

  for (const [title, snippet] of [
    ['Java Developer', null],
    ['Software Engineer', 'Python and Django microservices.'],
    ['Backend Engineer (Golang)', null],
    ['Senior Kotlin Engineer', null],
    ['Network Engineer', 'Cisco networks. Competitive net salary.'],
    ['Payroll Manager', 'Contract: 3 months IR35: Inside IR35.'],
    ['JavaScript Developer', null],
    ['Node.js Engineer', null],
  ]) {
    it(`ListAsync_AdvertIsNotRelevant_LeavesItOutButCountsIt (${title})`, async () => {
      const source = new FakeJobSource('A', () => [makeJob({ source: 'A', title, snippet })]);
      const service = create(source);

      const collection = await collectAndStore(service);
      const jobs = (await service.list(Query, collection.at)).value;

      assert.deepEqual(jobs, []);
      assert.equal(single(collection.sources).count, 1);
    });
  }
});
