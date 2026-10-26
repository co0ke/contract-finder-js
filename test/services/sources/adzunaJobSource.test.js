import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode } from '../../../src/common/errorCode.js';
import { AdzunaConstants } from '../../../src/constants/adzunaConstants.js';
import { JobSearchQuery } from '../../../src/models/jobSearch.js';
import { AdzunaJobSource, createAdzunaOptions } from '../../../src/services/sources/adzunaJobSource.js';
import { HttpClient } from '../../../src/services/sources/httpClient.js';
import { connectionRefused, single, stubFetch, throwingFetch, timedOut, utc } from '../../testDoubles.js';

const SampleResponse = `
{
  "count": 2,
  "results": [
    {
      "id": "4001",
      "title": "Senior .NET Developer - Contract",
      "description": "Outside IR35 day rate...",
      "created": "2026-09-20T10:15:00Z",
      "redirect_url": "https://www.adzuna.co.uk/jobs/land/ad/4001",
      "salary_min": 500,
      "salary_max": 600,
      "salary_is_predicted": "0",
      "company": { "display_name": "Contoso Recruitment" },
      "location": { "display_name": "London, UK" }
    },
    {
      "id": "4002",
      "title": "C# Engineer",
      "created": "2026-09-21T08:00:00Z",
      "redirect_url": "https://www.adzuna.co.uk/jobs/land/ad/4002",
      "salary_min": 450,
      "salary_is_predicted": "1"
    }
  ]
}`;

// What the live API actually sends: "utf8" rather than the standard "utf-8".
const AdzunaContentType = 'application/json; charset=utf8';

function create({ status = 200, body = SampleResponse, appId = 'id', appKey = 'key', contentType = AdzunaContentType } = {}) {
  const handler = stubFetch(status, body, contentType);
  const http = new HttpClient(AdzunaConstants.BaseAddress, handler);
  const options = createAdzunaOptions({ appId, appKey, country: 'gb' });
  return { source: new AdzunaJobSource(http, options), handler };
}

function createThrowing(error) {
  const http = new HttpClient(AdzunaConstants.BaseAddress, throwingFetch(error));
  return new AdzunaJobSource(http, createAdzunaOptions({ appId: 'id', appKey: 'key' }));
}

describe('AdzunaJobSource', () => {
  it('SearchAsync_ValidQuery_SendsUkContractSearchWithCredentials', async () => {
    const { source, handler } = create();

    await source.search(new JobSearchQuery(['.NET'], 3));

    const { url } = single(handler.requests);
    assert.equal(url.pathname, '/v1/api/jobs/gb/search/1');
    const query = url.searchParams;
    assert.equal(query.get('app_id'), 'id');
    assert.equal(query.get('app_key'), 'key');
    assert.equal(query.get('where'), null);
    assert.equal(query.get('contract'), '1');
    assert.equal(query.get('max_days_old'), '3');
    assert.equal(query.get('sort_by'), 'date');
    assert.equal(query.get('results_per_page'), '50');
  });

  for (const [keyword, used, unused] of [
    ['.NET', 'title_only', 'what'],
    ['C#', 'title_only', 'what'],
    ['software engineer', 'what', 'title_only'],
    ['Azure', 'what', 'title_only'],
  ]) {
    it(`SearchAsync_KeywordWithOrWithoutPunctuation_UsesTitleOnlyForPunctuation (${keyword})`, async () => {
      const { source, handler } = create();

      await source.search(new JobSearchQuery([keyword], 7));

      const query = single(handler.requests).url.searchParams;
      assert.equal(query.get(used), keyword);
      assert.equal(query.get(unused), null);
    });
  }

  it('SearchAsync_SeveralKeywords_SearchesEachAndReturnsEachJobOnce', async () => {
    const { source, handler } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET', 'Azure', 'software engineer'], 7))).value;

    assert.equal(handler.requests.length, 3);
    assert.deepEqual(jobs.map((j) => j.id), ['4001', '4002']);
  });

  it('SearchAsync_SampleResponse_MapsAllFields', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.equal(jobs.length, 2);
    const first = jobs[0];
    assert.equal(first.source, 'Adzuna');
    assert.equal(first.id, '4001');
    assert.equal(first.title, 'Senior .NET Developer - Contract');
    assert.equal(first.company, 'Contoso Recruitment');
    assert.equal(first.location, 'London, UK');
    assert.equal(first.dayRateMin, 500);
    assert.equal(first.dayRateMax, 600);
    assert.equal(first.rateIsEstimated, false);
    assert.deepEqual(first.postedAt, utc(2026, 9, 20, 10, 15, 0));
    assert.equal(first.url, 'https://www.adzuna.co.uk/jobs/land/ad/4001');
    assert.equal(first.snippet, 'Outside IR35 day rate...');
  });

  for (const contentType of [AdzunaContentType, 'application/json; charset=utf-8', 'application/json']) {
    it(`SearchAsync_AnyJsonCharset_ReadsBody (${contentType})`, async () => {
      const { source } = create({ contentType });

      const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

      assert.equal(jobs.length, 2);
    });
  }

  it('SearchAsync_MissingFieldsAndPredictedSalary_MapsNullsAndEstimatedRate', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    const second = jobs[1];
    assert.equal(second.company, null);
    assert.equal(second.location, null);
    assert.equal(second.dayRateMax, null);
    assert.equal(second.snippet, null);
    assert.equal(second.rateIsEstimated, true);
  });

  it('SearchAsync_YearlyOrJunkSalaries_ConvertsToDayRatesOrNull', async () => {
    const body = `
    {
      "results": [
        { "id": "1", "title": "t", "redirect_url": "u", "salary_min": 143000, "salary_max": 156000 },
        { "id": "2", "title": "t", "redirect_url": "u", "salary_min": 9100, "salary_max": 9100 }
      ]
    }`;
    const { source } = create({ body });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.equal(jobs[0].dayRateMin, 550);
    assert.equal(jobs[0].dayRateMax, 600);
    assert.equal(jobs[1].dayRateMin, null);
    assert.equal(jobs[1].dayRateMax, null);
  });

  for (const [json, expected] of [['true', true], ['1', true], ['false', false], ['0', false], ['"1"', true], ['"true"', true], ['"0"', false], ['null', false]]) {
    it(`SearchAsync_BooleanOrNumericPredictedFlag_MapsRateIsEstimated (${json})`, async () => {
      const body = `{ "results": [ { "id": "1", "title": "t", "redirect_url": "u", "salary_is_predicted": ${json} } ] }`;
      const { source } = create({ body });

      const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

      assert.equal(jobs[0].rateIsEstimated, expected);
    });
  }

  it('SearchAsync_ResponseHasNoResults_ReturnsEmpty', async () => {
    const { source } = create({ body: '{}' });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs, []);
  });

  for (const [appId, appKey] of [['', 'key'], ['id', ''], [' ', 'key']]) {
    it(`SearchAsync_CredentialsMissing_ReturnsMissingCredentialsWithoutSendingRequest (${JSON.stringify(appId)}, ${JSON.stringify(appKey)})`, async () => {
      const { source, handler } = create({ appId, appKey });

      const result = await source.search(new JobSearchQuery(['.NET'], 7));

      assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceMissingCredentials, 500]);
      assert.deepEqual(handler.requests, []);
    });
  }

  it('SearchAsync_ErrorStatus_ReturnsHttpErrorWithUpstreamStatus', async () => {
    const { source } = create({ status: 401, body: '{}' });

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceHttpError, 401]);
    assert.equal(result.errors[0].message, 'Adzuna returned 401 Unauthorized.');
  });

  it('SearchAsync_NoResponse_ReturnsUnreachable', async () => {
    const source = createThrowing(connectionRefused());

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceUnreachable, 500]);
    assert.equal(result.errors[0].message, "Couldn't reach Adzuna: connect ECONNREFUSED 127.0.0.1:443");
  });

  it('SearchAsync_Timeout_ReturnsTimeout', async () => {
    // How fetch reports its own timeout, as opposed to the caller cancelling.
    const source = createThrowing(timedOut());

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceTimeout, 500]);
  });

  it('SearchAsync_CallerCancels_Throws', async () => {
    // Not the site's fault, so not a source failure: it propagates like any other unexpected error.
    const source = createThrowing(new DOMException('The operation was aborted', 'AbortError'));

    await assert.rejects(source.search(new JobSearchQuery(['.NET'], 7)), { name: 'AbortError' });
  });

  it('SearchAsync_UnparseableResponse_Throws', async () => {
    const { source } = create({ body: '<html>not json</html>' });

    await assert.rejects(source.search(new JobSearchQuery(['.NET'], 7)), SyntaxError);
  });
});
