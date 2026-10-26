import assert from 'node:assert/strict';
import { beforeEach, describe, it, mock } from 'node:test';
import { createError } from '../../src/common/error.js';
import { ErrorCode } from '../../src/common/errorCode.js';
import { Result } from '../../src/common/result.js';
import { SearchConstants } from '../../src/constants/searchConstants.js';
import { createGetJobsHandler } from '../../src/functions/getJobs.js';
import { createSearchOptions } from '../../src/functions/searchOptions.js';
import { JobSearchQuery, JobSearchResult, SourceStatus, createJobCollection } from '../../src/models/jobSearch.js';
import { makeJob, utc } from '../testDoubles.js';

const CollectedAt = utc(2026, 9, 24, 9, 0, 0);
const Boom = createError(ErrorCode.SourceHttpError, 'Broken returned 401 Unauthorized.');

const failed = (name, upstreamStatus = 401) => new SourceStatus(name, 0, { upstreamStatus, errors: [Boom] });

const createRequest = (queryString = '') => ({ query: new URLSearchParams(queryString) });

describe('GetJobs', () => {
  /** The Moq mock of IJobSearchService: scripted returns, recorded calls. */
  let search;
  /** The query the last collect call received. */
  const lastQuery = () => search.collectAndStore.mock.calls.at(-1)?.arguments[0];

  const collectReturns = (result) => search.collectAndStore.mock.mockImplementation(async () => result);
  const listReturns = (result) => search.list.mock.mockImplementation(async () => result);
  const collected = (...sources) => collectReturns(Result.success(createJobCollection(CollectedAt, sources)));
  const listed = (...jobs) => listReturns(Result.success(jobs));

  const create = (keywords = null) => createGetJobsHandler({ search, options: createSearchOptions({ keywords }) });

  const errorCodes = (response, expectedStatus) => {
    assert.equal(response.status, expectedStatus);
    return response.jsonBody.errors.map((e) => e.code);
  };

  const verifyNotSearched = () => assert.equal(search.collectAndStore.mock.callCount(), 0);
  const verifyNotListed = () => assert.equal(search.list.mock.callCount(), 0);

  beforeEach(() => {
    search = { collectAndStore: mock.fn(), list: mock.fn() };
    collectReturns(Result.success(createJobCollection(CollectedAt, [])));
    listReturns(Result.success([]));
  });

  it('Run_NoParameters_SearchesDefaultKeywordsAndDays', async () => {
    await create()(createRequest());

    assert.deepEqual(lastQuery(), new JobSearchQuery(SearchConstants.DefaultKeywords, SearchConstants.DefaultMaxDaysOld));
  });

  it('Run_KeywordsConfigured_SearchesTrimmedNonBlankKeywords', async () => {
    await create([' Blazor ', '', 'F#'])(createRequest());

    assert.deepEqual(lastQuery().keywords, ['Blazor', 'F#']);
  });

  it('Run_ConfiguredKeywordsAllBlank_SearchesDefaultKeywords', async () => {
    await create([' '])(createRequest());

    assert.deepEqual(lastQuery().keywords, SearchConstants.DefaultKeywords);
  });

  it('Run_KeywordsGiven_SearchesThoseInsteadOfConfigured', async () => {
    await create(['Azure'])(createRequest('?q=Blazor,%20F%23%20,,backend%20engineer'));

    assert.deepEqual(lastQuery().keywords, ['Blazor', 'F#', 'backend engineer']);
  });

  it('Run_KeywordsRepeatedInDifferentCase_SearchesEachOnce', async () => {
    await create()(createRequest('?q=.NET,.net,Azure'));

    assert.deepEqual(lastQuery().keywords, ['.NET', 'Azure']);
  });

  it('Run_KeywordsBlank_SearchesConfiguredKeywords', async () => {
    await create(['Azure'])(createRequest('?q=%20,%20'));

    assert.deepEqual(lastQuery().keywords, ['Azure']);
  });

  for (const [keywords, code] of [
    ['a,b,c,d,e,f,g,h,i,j,k', ErrorCode.TooManyKeywords],
    ['this keyword is far too long to be a sensible search term for a job site at all', ErrorCode.KeywordTooLong],
  ]) {
    it(`Run_TooManyOrTooLongKeywords_ReturnsBadRequestWithoutSearching (${code})`, async () => {
      const result = await create()(createRequest(`?q=${encodeURIComponent(keywords)}`));

      assert.deepEqual(errorCodes(result, 400), [code]);
      verifyNotSearched();
    });
  }

  it('Run_InvalidDaysAndTooManyKeywords_ReturnsBadRequestWithBothErrors', async () => {
    const result = await create()(createRequest('?days=0&q=a,b,c,d,e,f,g,h,i,j,k'));

    assert.deepEqual(errorCodes(result, 400), [ErrorCode.DaysOutOfRange, ErrorCode.TooManyKeywords]);
    verifyNotSearched();
  });

  for (const days of ['abc', '0', '-1', '61', '2.5', '1e1', '0x10']) {
    it(`Run_InvalidDays_ReturnsBadRequestWithoutSearching (${days})`, async () => {
      const result = await create()(createRequest(`?days=${days}`));

      assert.deepEqual(errorCodes(result, 400), [ErrorCode.DaysOutOfRange]);
      verifyNotSearched();
    });
  }

  for (const days of ['1', '60']) {
    it(`Run_BoundaryDays_SearchesThatManyDays (${days})`, async () => {
      const result = await create()(createRequest(`?days=${days}`));

      assert.equal(result.status, 200);
      assert.equal(lastQuery().maxDaysOld, Number(days));
    });
  }

  it('Run_StoreUnavailableWhileCollecting_Returns503WithoutListing', async () => {
    collectReturns(Result.failure(500, createError(ErrorCode.StoreUnavailable, "Can't reach table storage.")));

    const result = await create()(createRequest());

    assert.deepEqual(errorCodes(result, 503), [ErrorCode.StoreUnavailable]);
    verifyNotListed();
  });

  it('Run_StoreUnavailableWhileListing_Returns503WithErrors', async () => {
    listReturns(Result.failure(500, createError(ErrorCode.StoreUnavailable, "Can't reach table storage.")));

    const result = await create()(createRequest());

    assert.deepEqual(errorCodes(result, 503), [ErrorCode.StoreUnavailable]);
  });

  it('Run_Collected_ListsAsOfCollectionTime', async () => {
    await create()(createRequest('?days=3'));

    assert.equal(search.list.mock.callCount(), 1);
    assert.deepEqual(search.list.mock.calls[0].arguments, [lastQuery(), CollectedAt]);
  });

  it('Run_SearchSucceeds_ReturnsOkWithKeywordsSourcesAndJobs', async () => {
    const job = makeJob({ source: 'A' });
    collected(new SourceStatus('A', 1));
    listed(job);

    const result = await create()(createRequest('?q=.NET'));

    assert.equal(result.status, 200);
    const body = result.jsonBody;
    assert.ok(body instanceof JobSearchResult);
    assert.deepEqual(body.keywords, ['.NET']);
    assert.deepEqual(body.sources, [new SourceStatus('A', 1)]);
    assert.deepEqual(body.jobs, [job]);
  });

  it('Run_SourceUpstream401_Returns200NotUpstreamStatus', async () => {
    collected(failed('Broken'), new SourceStatus('Working', 1));
    listed(makeJob({ source: 'Working' }));

    const result = await create()(createRequest());

    assert.equal(result.status, 200);
    assert.equal(result.jsonBody.sources[0].upstreamStatus, 401);
  });

  it('ResponseBody_Serialised_WritesErrorCodesByNameAndUpstreamStatusAsNumber', () => {
    const body = new JobSearchResult(['.NET'], [failed('Broken')], []);

    const json = JSON.stringify(body);

    assert.ok(json.includes('"upstreamStatus":401'));
    assert.ok(json.includes('"code":"SourceHttpError"'));
    assert.ok(json.includes('"count":0'));
    assert.ok(!json.includes('"failed"'));
  });

  it('ResponseBody_Serialised_WritesCamelCaseDatesAndRelevanceByName', () => {
    const job = { ...makeJob({ postedAt: utc(2026, 9, 22, 8, 0, 0) }), relevance: 'StackMatch', isNew: true };

    const json = JSON.stringify(new JobSearchResult(['.NET'], [], [job]));

    assert.ok(json.includes('"postedAt":"2026-09-22T08:00:00.000Z"'));
    assert.ok(json.includes('"relevance":"StackMatch"'));
    assert.ok(json.includes('"isNew":true'));
    assert.ok(json.includes('"firstSeenAt":null'));
  });

  it('Run_AllSourcesFailed_Returns502WithResult', async () => {
    collected(failed('A'), failed('B', 500));

    const result = await create()(createRequest());

    assert.equal(result.status, 502);
    assert.deepEqual(result.jsonBody.sources.map((s) => s.name), ['A', 'B']);
  });
});
