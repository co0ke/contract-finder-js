import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode } from '../../../src/common/errorCode.js';
import { TechJobsConstants } from '../../../src/constants/techJobsConstants.js';
import { createJob } from '../../../src/models/job.js';
import { JobSearchQuery } from '../../../src/models/jobSearch.js';
import { HttpClient } from '../../../src/services/sources/httpClient.js';
import { TechJobsJobSource } from '../../../src/services/sources/techJobsJobSource.js';
import { connectionRefused, single, stubFetch, throwingFetch, timedOut, utc } from '../../testDoubles.js';

const SampleResponse = `
{
  "jobs": [
    {
      "id": "11111111-1111-1111-1111-111111111111",
      "slug": "senior-c-developer-gcs-abc123",
      "title": "Senior C# Developer",
      "organizationName": "GCS",
      "town": "London",
      "city": "London",
      "country": "United Kingdom",
      "jobType": "inside-ir35",
      "salaryMin": "400.00",
      "salaryMax": "416.00",
      "salaryType": "daily",
      "shortDescription": "C#, Azure...",
      "postedAt": "2026-09-27T00:06:47.160Z"
    },
    {
      "id": "22222222-2222-2222-2222-222222222222",
      "slug": "net-architect-xyz",
      "title": ".NET Architect",
      "organizationName": "Contoso",
      "town": null,
      "city": null,
      "jobType": "outside-ir35",
      "salaryMin": "120000.00",
      "salaryMax": "130000.00",
      "salaryType": "annual",
      "shortDescription": null,
      "postedAt": "2026-09-26T10:00:00.000Z"
    },
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "slug": "dotnet-dev-nosalary",
      "title": ".NET Developer",
      "salaryMin": null,
      "salaryMax": null,
      "salaryType": null,
      "postedAt": null
    }
  ],
  "total": 3
}`;

function create({ status = 200, body = SampleResponse } = {}) {
  const handler = stubFetch(status, body);
  const http = new HttpClient(TechJobsConstants.BaseAddress, handler);
  return { source: new TechJobsJobSource(http), handler };
}

function createThrowing(error) {
  return new TechJobsJobSource(new HttpClient(TechJobsConstants.BaseAddress, throwingFetch(error)));
}

describe('TechJobsJobSource', () => {
  it('SearchAsync_ValidQuery_SendsContractSearchWithServerSideFilters', async () => {
    const { source, handler } = create();

    await source.search(new JobSearchQuery(['C#'], 7));

    const request = single(handler.requests);
    assert.equal(request.url.pathname, '/api/jobs/search');
    const query = request.url.searchParams;
    assert.equal(query.get('q'), 'C#');
    assert.equal(query.get('jobTypes'), 'inside-ir35,outside-ir35');
    assert.equal(query.get('postedWithinDays'), '7');
    assert.equal(query.get('limit'), '50');
    assert.equal(query.get('location'), null);
  });

  it('SearchAsync_SampleResponse_MapsAllFields', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    const expected = createJob({
      source: 'TechJobs',
      id: '11111111-1111-1111-1111-111111111111',
      title: 'Senior C# Developer',
      company: 'GCS',
      location: 'London',
      dayRateMin: 400,
      dayRateMax: 416,
      rateIsEstimated: false,
      postedAt: utc(2026, 9, 27, 0, 6, 47, 160),
      url: 'https://www.techjobs.co.uk/jobs/senior-c-developer-gcs-abc123',
      snippet: 'C#, Azure...',
    });
    assert.deepEqual(jobs[0], expected);
  });

  it('SearchAsync_AnnualSalaryAndNoLocation_DropsRateAndDefaultsLocationToUk', async () => {
    const { source } = create();

    const job = (await source.search(new JobSearchQuery(['.NET'], 7))).value[1];

    assert.deepEqual([job.dayRateMin, job.dayRateMax, job.location], [null, null, 'United Kingdom']);
  });

  it('SearchAsync_NoSalaryOrDate_MapsNulls', async () => {
    const { source } = create();

    const job = (await source.search(new JobSearchQuery(['.NET'], 7))).value[2];

    assert.deepEqual([job.dayRateMin, job.dayRateMax, job.postedAt, job.company], [null, null, null, null]);
  });

  it('SearchAsync_NumericSalary_ReadsItLikeAString', async () => {
    const body = `{ "jobs": [ { "id": "1", "slug": "s", "title": "t", "salaryMin": 450, "salaryMax": 500.5, "salaryType": "Daily" } ] }`;
    const { source } = create({ body });

    const job = single((await source.search(new JobSearchQuery(['.NET'], 7))).value);

    assert.deepEqual([job.dayRateMin, job.dayRateMax], [450, 500]);
  });

  it('SearchAsync_SeveralKeywords_SearchesEachAndReturnsEachJobOnce', async () => {
    const { source, handler } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET', 'C#'], 7))).value;

    assert.deepEqual(handler.requests.map((r) => r.url.searchParams.get('q')).sort(), ['.NET', 'C#']);
    assert.equal(jobs.length, 3);
  });

  it('SearchAsync_ResponseHasNoJobs_ReturnsEmpty', async () => {
    const { source } = create({ body: '{}' });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs, []);
  });

  it('SearchAsync_ErrorStatus_ReturnsHttpErrorWithUpstreamStatus', async () => {
    const { source } = create({ status: 503, body: '{}' });

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceHttpError, 503]);
  });

  it('SearchAsync_NoResponse_ReturnsUnreachable', async () => {
    const source = createThrowing(connectionRefused());

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceUnreachable, 500]);
  });

  it('SearchAsync_Timeout_ReturnsTimeout', async () => {
    const source = createThrowing(timedOut());

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceTimeout, 500]);
  });
});
