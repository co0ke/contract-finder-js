import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode } from '../../../src/common/errorCode.js';
import { ReedConstants } from '../../../src/constants/reedConstants.js';
import { createJob } from '../../../src/models/job.js';
import { JobSearchQuery } from '../../../src/models/jobSearch.js';
import { HttpClient } from '../../../src/services/sources/httpClient.js';
import { ReedJobSource, createReedOptions } from '../../../src/services/sources/reedJobSource.js';
import { RetryPolicy } from '../../../src/services/sources/retryPolicy.js';
import { connectionRefused, fixedTime, single, stubFetch, throwingFetch, timedOut, utc } from '../../testDoubles.js';

const Now = utc(2026, 9, 23, 12, 0, 0);

const SampleResponse = `
{
  "totalResults": 3,
  "results": [
    {
      "jobId": 55001,
      "employerId": 1,
      "employerName": "Fabrikam",
      "jobTitle": ".NET Contractor",
      "locationName": "Manchester",
      "minimumSalary": 450.0,
      "maximumSalary": 550.0,
      "currency": "GBP",
      "date": "22/09/2026",
      "jobDescription": "Azure Functions, C#...",
      "jobUrl": "https://www.reed.co.uk/jobs/net-contractor/55001"
    },
    {
      "jobId": 55002,
      "jobTitle": "C# .NET Developer",
      "date": "01/09/2026",
      "jobUrl": "https://www.reed.co.uk/jobs/c-developer/55002"
    },
    {
      "jobId": 55003,
      "jobTitle": "Blazor .NET Developer",
      "date": null,
      "jobUrl": "https://www.reed.co.uk/jobs/blazor-developer/55003"
    }
  ]
}`;

function create({ status = 200, body = SampleResponse, apiKey = 'reed-key' } = {}) {
  const handler = stubFetch(status, body);
  const http = new HttpClient(ReedConstants.BaseAddress, handler);
  return { source: new ReedJobSource(http, createReedOptions({ apiKey }), fixedTime(Now)), handler };
}

function createThrowing(error) {
  const http = new HttpClient(ReedConstants.BaseAddress, throwingFetch(error));
  return new ReedJobSource(http, createReedOptions({ apiKey: 'reed-key' }), fixedTime(Now));
}

describe('ReedJobSource', () => {
  it('SearchAsync_ValidQuery_SendsContractSearchWithBasicAuth', async () => {
    const { source, handler } = create();

    await source.search(new JobSearchQuery(['.NET'], 7));

    const request = single(handler.requests);
    assert.equal(request.url.pathname, '/api/1.0/search');
    const query = request.url.searchParams;
    assert.equal(query.get('keywords'), '.NET');
    assert.equal(query.get('locationName'), null);
    assert.equal(query.get('contract'), 'true');
    assert.equal(query.get('resultsToTake'), '100');

    const [scheme, parameter] = request.headers.get('Authorization').split(' ');
    assert.equal(scheme, 'Basic');
    assert.equal(Buffer.from(parameter, 'base64').toString('utf8'), 'reed-key:');
  });

  it('SearchAsync_SampleResponse_MapsAllFields', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    const expected = createJob({
      source: 'Reed',
      id: '55001',
      title: '.NET Contractor',
      company: 'Fabrikam',
      location: 'Manchester',
      dayRateMin: 450,
      dayRateMax: 550,
      rateIsEstimated: false,
      postedAt: utc(2026, 9, 22),
      url: 'https://www.reed.co.uk/jobs/net-contractor/55001',
      snippet: 'Azure Functions, C#...',
    });
    assert.deepEqual(jobs[0], expected);
  });

  it('SearchAsync_YearlySalaries_ConvertsToDayRates', async () => {
    // Not yet confirmed whether Reed sends daily or yearly figures for contracts, so both must work.
    const body = `{ "results": [ { "jobId": 1, "jobTitle": ".NET Developer", "jobUrl": "u", "date": "22/09/2026", "minimumSalary": 130000, "maximumSalary": 143000 } ] }`;
    const { source } = create({ body });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.equal(jobs[0].dayRateMin, 500);
    assert.equal(jobs[0].dayRateMax, 550);
  });

  it('SearchAsync_JobsOlderThanMaxDaysOld_DropsThemButKeepsUndated', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs.map((j) => j.id), ['55001', '55003']);
  });

  it('SearchAsync_WideMaxDaysOld_KeepsOlderJobs', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 30))).value;

    assert.equal(jobs.length, 3);
  });

  for (const [date, kept] of [['16/09/2026', true], ['15/09/2026', false]]) {
    it(`SearchAsync_JobAtCutoffBoundary_KeepsCutoffDayAndDropsDayBefore (${date})`, async () => {
      const body = `{ "results": [ { "jobId": 1, "jobTitle": ".NET Developer", "jobUrl": "u", "date": "${date}" } ] }`;
      const { source } = create({ body });

      const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

      assert.equal(jobs.length, kept ? 1 : 0);
    });
  }

  for (const date of ['2026-09-22', '31/02/2026', 'yesterday', '']) {
    it(`SearchAsync_DateNotInReedsFormat_MapsUndated (${JSON.stringify(date)})`, async () => {
      const body = `{ "results": [ { "jobId": 1, "jobTitle": ".NET Developer", "jobUrl": "u", "date": "${date}" } ] }`;
      const { source } = create({ body });

      const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

      assert.equal(single(jobs).postedAt, null);
    });
  }

  it('SearchAsync_SearchTermOnlyInDescription_KeepsJobForRelevanceRules', async () => {
    // Trimmed from a real ".NET" search: Reed matched "net" somewhere in the full advert.
    // The search service's relevance rules, not the source, decide whether it's listed.
    const body = `
    {
      "results": [
        {
          "jobId": 57382848,
          "jobTitle": "Interim Payroll Manager",
          "date": "22/09/2026",
          "jobDescription": "Payroll Manager Location: Flexible Contract: 3 months IR35: Inside IR35...",
          "jobUrl": "https://www.reed.co.uk/jobs/interim-payroll-manager/57382848"
        },
        {
          "jobId": 57356123,
          "jobTitle": "Full Stack Developer .Net React AWS",
          "date": "22/09/2026",
          "jobUrl": "https://www.reed.co.uk/jobs/full-stack-developer-net-react-aws/57356123"
        }
      ]
    }`;
    const { source } = create({ body });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs.map((j) => j.id), ['57382848', '57356123']);
  });

  it('SearchAsync_SeveralKeywords_SearchesEachAndReturnsEachJobOnce', async () => {
    const { source, handler } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET', 'C#'], 30))).value;

    assert.deepEqual(handler.requests.map((r) => r.url.searchParams.get('keywords')).sort(), ['.NET', 'C#']);
    assert.deepEqual(jobs.map((j) => j.id), ['55001', '55002', '55003']);
  });

  it('SearchAsync_ResponseHasNoResults_ReturnsEmpty', async () => {
    const { source } = create({ body: '{}' });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs, []);
  });

  it('SearchAsync_ApiKeyMissing_ReturnsMissingCredentialsWithoutSendingRequest', async () => {
    const { source, handler } = create({ apiKey: ' ' });

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceMissingCredentials, 500]);
    assert.deepEqual(handler.requests, []);
  });

  it('SearchAsync_SeveralKeywordsFail_ReturnsEveryError', async () => {
    const { source } = create({ status: 401, body: '{}' });

    const result = await source.search(new JobSearchQuery(['.NET', 'C#'], 7));

    assert.deepEqual(result.errors.map((e) => e.code), [ErrorCode.SourceHttpError, ErrorCode.SourceHttpError]);
    assert.equal(result.statusCode, 401);
  });

  it('SearchAsync_ErrorStatus_ReturnsHttpErrorWithUpstreamStatus', async () => {
    const { source } = create({ status: 401, body: '{}' });

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceHttpError, 401]);
  });

  it('SearchAsync_SiteRecoversWithinRetries_ReturnsJobs', async () => {
    const requests = [];
    const flaky = async (url, init) => {
      requests.push(url);
      return requests.length <= 2 ? new Response('', { status: 503 }) : new Response(SampleResponse, { status: 200 });
    };
    const retry = new RetryPolicy({ sleep: async () => {} });
    const source = new ReedJobSource(new HttpClient(ReedConstants.BaseAddress, flaky, { retry }), createReedOptions({ apiKey: 'k' }), fixedTime(Now));

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.equal(result.isSuccess, true);
    assert.equal(requests.length, 3);
  });

  it('SearchAsync_SiteKeepsFailing_ReportsHttpErrorAfterRetries', async () => {
    const { handler } = create({ status: 503, body: '{}' });
    const retry = new RetryPolicy({ sleep: async () => {} });
    const retrying = new ReedJobSource(new HttpClient(ReedConstants.BaseAddress, handler, { retry }), createReedOptions({ apiKey: 'k' }), fixedTime(Now));

    const result = await retrying.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceHttpError, 503]);
    assert.equal(handler.requests.length, 3);
  });

  it('SearchAsync_Unauthorised_IsNotRetried', async () => {
    const { handler } = create({ status: 401, body: '{}' });
    const retry = new RetryPolicy({ sleep: async () => {} });
    const retrying = new ReedJobSource(new HttpClient(ReedConstants.BaseAddress, handler, { retry }), createReedOptions({ apiKey: 'k' }), fixedTime(Now));

    await retrying.search(new JobSearchQuery(['.NET'], 7));

    assert.equal(handler.requests.length, 1);
  });

  it('SearchAsync_NoResponse_ReturnsUnreachable', async () => {
    const source = createThrowing(connectionRefused());

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceUnreachable, 500]);
  });

  it('SearchAsync_Timeout_ReturnsTimeout', async () => {
    // How fetch reports its own timeout, as opposed to the caller cancelling.
    const source = createThrowing(timedOut());

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceTimeout, 500]);
  });
});
