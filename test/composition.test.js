import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApp } from '../src/composition.js';
import { ErrorCode } from '../src/common/errorCode.js';
import { InMemoryJobStore } from '../src/services/storage/inMemoryJobStore.js';
import { nullLogger } from '../src/services/logger.js';
import { RetryPolicy } from '../src/services/sources/retryPolicy.js';
import { addHours, fixedTime, utc } from './testDoubles.js';

const Now = utc(2026, 9, 25, 12, 0, 0);
const request = (queryString = '') => ({ query: new URLSearchParams(queryString) });

// No environment at all: the defaults must be enough to run.
const mockApp = (env = {}, overrides = {}) => createApp({ env, time: fixedTime(Now), logger: nullLogger, ...overrides });

describe('createApp (mock externals)', () => {
  it('GetJobs_NoConfiguration_SearchesEveryMockSiteAndListsRelevantAdverts', async () => {
    const app = await mockApp();

    const response = await app.handlers.getJobs(request());

    assert.equal(response.status, 200);
    const body = response.jsonBody;
    assert.deepEqual(body.sources.map((s) => [s.name, s.failed]), [
      ['Adzuna', false], ['Reed', false], ['emagine', false], ['JobServe', false], ['TechJobs', false],
    ]);
    assert.ok(body.jobs.length > 0);
    assert.ok(body.jobs.every((j) => j.relevance === 'StackMatch' || j.relevance === 'Generic'));
    assert.ok(body.jobs.every((j) => j.isNew));
    // Newest first.
    const times = body.jobs.map((j) => j.postedAt?.getTime() ?? -Infinity);
    assert.deepEqual(times, [...times].sort((a, b) => b - a));
  });

  it('GetJobs_SearchedTwice_SecondSearchMarksNothingNew', async () => {
    const store = new InMemoryJobStore();
    await (await mockApp({}, { store })).handlers.getJobs(request());

    const later = await createApp({ env: {}, time: fixedTime(addHours(Now, 1)), logger: nullLogger, store });
    const body = (await later.handlers.getJobs(request())).jsonBody;

    assert.ok(body.jobs.length > 0);
    assert.ok(body.jobs.every((j) => !j.isNew));
    assert.ok(body.jobs.every((j) => j.firstSeenAt.getTime() === Now.getTime()));
  });

  it('GetJobs_MockSitesShareAnAdvert_ListsItOnce', async () => {
    const body = (await (await mockApp()).handlers.getJobs(request())).jsonBody;

    const seniorDotNet = body.jobs.filter((j) => j.title.toLowerCase().startsWith('senior .net developer'));
    assert.equal(seniorDotNet.length, 1);
  });

  it('GetJobs_FailingSourcesConfigured_ReportsThemWithoutFailingTheSearch', async () => {
    const app = await mockApp({ MOCK_FAILING_SOURCES: 'Reed, JobServe' });

    const response = await app.handlers.getJobs(request());

    assert.equal(response.status, 200);
    const byName = new Map(response.jsonBody.sources.map((s) => [s.name, s]));
    assert.deepEqual([byName.get('Reed').upstreamStatus, byName.get('Reed').errors[0].code], [401, ErrorCode.SourceHttpError]);
    assert.deepEqual([byName.get('JobServe').upstreamStatus, byName.get('JobServe').errors[0].code], [500, ErrorCode.SourceBlocked]);
    assert.equal(byName.get('Adzuna').failed, false);
  });

  it('GetJobs_FlakySourceConfigured_RecoversThroughRetries', async () => {
    const warnings = [];
    const logger = { ...nullLogger, warn: (line) => warnings.push(line) };
    const app = await mockApp({ MOCK_FLAKY_SOURCES: 'Reed' }, { logger, retryPolicy: new RetryPolicy({ sleep: async () => {}, logger }) });

    const response = await app.handlers.getJobs(request('?q=.NET'));

    const reed = response.jsonBody.sources.find((s) => s.name === 'Reed');
    assert.equal(reed.failed, false);
    assert.ok(reed.count > 0);
    assert.deepEqual(warnings.map((w) => w.replace(/in \d+ ms/, 'in N ms')), [
      'GET www.reed.co.uk/api/1.0/search returned 503; retry 1 of 2 in N ms.',
      'GET www.reed.co.uk/api/1.0/search returned 503; retry 2 of 2 in N ms.',
    ]);
  });

  it('GetJobs_FailingSourceWithRetries_StillFailsWithoutRetryingClientErrors', async () => {
    const warnings = [];
    const logger = { ...nullLogger, warn: (line) => warnings.push(line) };
    const app = await mockApp({ MOCK_FAILING_SOURCES: 'Reed' }, { logger, retryPolicy: new RetryPolicy({ sleep: async () => {}, logger }) });

    const response = await app.handlers.getJobs(request('?q=.NET'));

    const reed = response.jsonBody.sources.find((s) => s.name === 'Reed');
    assert.equal(reed.upstreamStatus, 401);
    assert.ok(!warnings.some((w) => w.includes('retry')), warnings.join('\n'));
  });

  it('GetJobs_EverySourceFailing_Returns502', async () => {
    const app = await mockApp({ MOCK_FAILING_SOURCES: 'Adzuna,Reed,emagine,JobServe,TechJobs' });

    const response = await app.handlers.getJobs(request());

    assert.equal(response.status, 502);
  });

  it('App_KeywordsConfiguredAsIndexedSettings_ServesThem', async () => {
    const app = await mockApp({ Search__Keywords__0: 'Blazor', Search__Keywords__1: 'F#' });

    const page = app.handlers.app(request());

    assert.ok(page.body.includes('data-default-keywords="Blazor, F#"'));
    const body = (await app.handlers.getJobs(request())).jsonBody;
    assert.deepEqual(body.keywords, ['Blazor', 'F#']);
  });

  it('CleanUpJobs_NothingOld_LogsZeroDeleted', async () => {
    const lines = [];
    const app = await mockApp({}, { logger: { ...nullLogger, info: (line) => lines.push(line) } });
    await app.handlers.getJobs(request());

    await app.handlers.cleanUpJobs();

    assert.ok(lines.includes('Cleanup deleted 0 entries.'), lines.join('\n'));
  });

  it('CreateApp_MockMode_NeverUsesTheRealFetch', async () => {
    const calls = [];
    const app = await mockApp({}, { fetchImpl: undefined });
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => { calls.push(url); throw new Error('network used'); };
    try {
      await app.handlers.getJobs(request());
    } finally {
      globalThis.fetch = original;
    }

    assert.deepEqual(calls, []);
  });
});

describe('createApp (live externals)', () => {
  it('CreateApp_LiveModeWithInjectedStoreAndFetch_UsesRealSourcesAgainstThem', async () => {
    const urls = [];
    const fetchImpl = async (url) => {
      urls.push(new URL(url).host);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    const app = await createApp({
      env: { MOCK_EXTERNALS: 'false', Adzuna__AppId: 'id', Adzuna__AppKey: 'key', Reed__ApiKey: 'key' },
      time: fixedTime(Now), logger: nullLogger, fetchImpl, store: new InMemoryJobStore(),
    });

    const response = await app.handlers.getJobs(request('?q=.NET'));

    // JobServe gets a blocked page ("{}" has no body elements), the JSON sites return nothing.
    assert.equal(response.status, 200);
    assert.deepEqual([...new Set(urls)].sort(), [
      'api.adzuna.com', 'api.techjobs.co.uk', 'portal-api.emagine.org', 'www.jobserve.com', 'www.reed.co.uk',
    ]);
  });

  it('CreateApp_LiveModeWithoutCredentials_SourcesReportMissingCredentials', async () => {
    const app = await createApp({
      env: { MOCK_EXTERNALS: 'false' },
      time: fixedTime(Now), logger: nullLogger,
      fetchImpl: async () => new Response('{}', { status: 200 }),
      store: new InMemoryJobStore(),
    });

    const body = (await app.handlers.getJobs(request('?q=.NET'))).jsonBody;

    const byName = new Map(body.sources.map((s) => [s.name, s]));
    assert.equal(byName.get('Adzuna').errors[0].code, ErrorCode.SourceMissingCredentials);
    assert.equal(byName.get('Reed').errors[0].code, ErrorCode.SourceMissingCredentials);
  });
});
