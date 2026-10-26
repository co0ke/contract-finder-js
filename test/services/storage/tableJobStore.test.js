import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createError } from '../../../src/common/error.js';
import { ErrorCode } from '../../../src/common/errorCode.js';
import { TableStoreConstants } from '../../../src/constants/tableStoreConstants.js';
import { createJob } from '../../../src/models/job.js';
import { createSourceRun } from '../../../src/models/jobSearch.js';
import { TableJobStore } from '../../../src/services/storage/tableJobStore.js';
import { makeJob, single, utc } from '../../testDoubles.js';

const FirstSeen = utc(2026, 9, 20, 9, 0, 0);
const LastSeen = utc(2026, 9, 25, 9, 0, 0);

describe('TableJobStore', () => {
  for (const [value, expected] of [
    ['4001', '4001'],
    ['F827AF2E80CF7D71E8', 'F827AF2E80CF7D71E8'],
    ['a/b\\c#d?e', 'a%2Fb%5Cc%23d%3Fe'],
    ['100%', '100%25'],
    ['tab\there', 'tab%09here'],
    ['del\u007Fhere', 'del%7Fhere'],
  ]) {
    it(`EscapeKey_AnyValue_ReplacesCharactersTableStorageRejects (${JSON.stringify(value)})`, () => {
      assert.equal(TableJobStore.escapeKey(value), expected);
    });
  }

  it('EscapeKey_IdsDifferingOnlyByEscapedText_StayDistinct', () => {
    assert.notEqual(TableJobStore.escapeKey('a/b'), TableJobStore.escapeKey('a%2Fb'));
  });

  it('SinceFilter_AnyTime_ComparesColumnWithUtcDateTime', () => {
    // 01:00 at UTC+1 is midnight UTC.
    const since = new Date(Date.UTC(2026, 8, 18, 1, 0, 0) - 60 * 60 * 1000);

    assert.equal(TableJobStore.sinceFilter(since), "PostedOrLastSeenAt ge datetime'2026-09-18T00:00:00Z'");
  });

  it('SinceFilter_TimeWithMilliseconds_KeepsThemWithoutTrailingZeros', () => {
    assert.equal(TableJobStore.sinceFilter(utc(2026, 9, 18, 0, 0, 0, 120)), "PostedOrLastSeenAt ge datetime'2026-09-18T00:00:00.12Z'");
  });

  it('ToEntity_AnyJob_KeysOnSourceAndId', () => {
    const entity = TableJobStore.toEntity(makeJob({ source: 'JobServe', id: 'a/1' }), FirstSeen, LastSeen);

    assert.equal(entity.partitionKey, 'JobServe');
    assert.equal(entity.rowKey, 'a%2F1');
  });

  it('ToJob_EntityFromFullJob_RoundTripsWithFirstSeenAt', () => {
    const job = createJob({
      source: 'Adzuna', id: 'a/1', title: 'Senior .NET Developer', company: 'Contoso', location: 'London',
      dayRateMin: 512.5, dayRateMax: 600, rateIsEstimated: true,
      postedAt: utc(2026, 9, 21, 7, 0, 0), url: 'https://example.com/1', snippet: 'C# and Azure',
    });

    const result = TableJobStore.toJob(TableJobStore.toEntity(job, FirstSeen, LastSeen));

    assert.deepEqual(result, { ...job, firstSeenAt: FirstSeen });
  });

  it('ToJob_EntityFromSparseJob_RoundTripsNulls', () => {
    const job = makeJob({ source: 'emagine', company: null });

    const result = TableJobStore.toJob(TableJobStore.toEntity(job, FirstSeen, LastSeen));

    assert.deepEqual(result, { ...job, firstSeenAt: FirstSeen });
  });

  it('ToJob_EntityWithPropertiesTheServiceDropped_ReadsNulls', () => {
    // Table Storage doesn't store null properties, so they come back missing rather than null.
    const entity = TableJobStore.toEntity(makeJob({ source: 'emagine', company: null }), FirstSeen, LastSeen);
    for (const key of Object.keys(entity)) {
      if (entity[key] === null) {
        delete entity[key];
      }
    }

    const result = TableJobStore.toJob(entity);

    assert.deepEqual([result.company, result.dayRateMin, result.postedAt, result.snippet], [null, null, null, null]);
  });

  it('ToEntity_DayRates_AreStoredAsStrings', () => {
    const entity = TableJobStore.toEntity(makeJob({ dayRateMin: 512.5, dayRateMax: 600 }), FirstSeen, LastSeen);

    assert.deepEqual([entity.DayRateMin, entity.DayRateMax], ['512.5', '600']);
  });

  it('ToEntity_UndatedJob_IsListedByLastSeenTime', () => {
    const entity = TableJobStore.toEntity(makeJob({ postedAt: null }), FirstSeen, LastSeen);

    assert.deepEqual(entity[TableStoreConstants.PostedOrLastSeenAtColumn], LastSeen);
  });

  it('ToEntity_DatedJob_IsListedByPostedTime', () => {
    const posted = utc(2026, 9, 22);

    const entity = TableJobStore.toEntity(makeJob({ postedAt: posted }), FirstSeen, LastSeen);

    assert.deepEqual(entity[TableStoreConstants.PostedOrLastSeenAtColumn], posted);
  });

  it('QueryAsync_StoreUnreachable_ReturnsStoreUnavailable', async () => {
    // Nothing listens on port 1, so the connection is refused straight away.
    const clients = TableJobStore.createClients(
      'DefaultEndpointsProtocol=http;AccountName=devstoreaccount1;'
      + 'AccountKey=Eby8vdM02xNOcqFlqUwJPLlmEtlCDXJ1OUzFT50uSRZ6IFsuFq2UVErCz4I6tq/K1SZFPTOtr/KBHBeksoGMGw==;'
      + 'TableEndpoint=http://127.0.0.1:1/devstoreaccount1;',
      { maxRetries: 0, networkTimeoutMs: 5000 });

    const result = await new TableJobStore(clients).query(FirstSeen);

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.StoreUnavailable, 500]);
  });

  it('ToRun_EntityFromFailedRun_RoundTripsErrorCodeAndMessage', () => {
    const run = createSourceRun('a/Reed', LastSeen, 0, createError(ErrorCode.SourceHttpError, 'Reed returned 401 Unauthorized.'));

    assert.deepEqual(TableJobStore.toRun(run.source, TableJobStore.toRunEntity(run)), run);
  });

  it('ToRun_EntityFromSuccessfulRun_HasNoError', () => {
    const run = createSourceRun('Reed', LastSeen, 12, null);

    assert.deepEqual(TableJobStore.toRun(run.source, TableJobStore.toRunEntity(run)), run);
  });

  it('ToRun_RowStoredBeforeErrorCodes_ReadsAsUnknown', () => {
    const entity = TableJobStore.toRunEntity(createSourceRun('Reed', LastSeen, 0, null));
    entity.Error = '401 Unauthorized';

    assert.deepEqual(TableJobStore.toRun('Reed', entity).error, createError(ErrorCode.Unknown, '401 Unauthorized'));
  });

  it('ToRun_CountReadBackAsPlainNumber_IsUsed', () => {
    // The SDK hands Int32 columns back as numbers, not as the typed object this store writes.
    const entity = { ...TableJobStore.toRunEntity(createSourceRun('Reed', LastSeen, 12, null)), Count: 12 };

    assert.equal(TableJobStore.toRun('Reed', entity).count, 12);
  });

  it('ToRunEntity_LaterRun_SortsBeforeEarlierRun', () => {
    // Rows come back in key order, so the newest run must have the smallest key.
    const earlier = TableJobStore.toRunEntity(createSourceRun('Reed', LastSeen, 1, null));
    const later = TableJobStore.toRunEntity(createSourceRun('Reed', new Date(LastSeen.getTime() + 1), 1, null));

    assert.equal(earlier.rowKey.length, 19);
    assert.ok(later.rowKey < earlier.rowKey);
  });

  it('ToRunEntity_KnownInstant_MatchesDotNetInvertedTicks', () => {
    // (DateTimeOffset.MaxValue.UtcTicks - ticks of 2026-09-25T09:00:00Z), as the C# store wrote it.
    const entity = TableJobStore.toRunEntity(createSourceRun('Reed', LastSeen, 1, null));

    assert.equal(entity.rowKey, '2516119739999999999');
  });
});
