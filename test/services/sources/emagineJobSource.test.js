import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode } from '../../../src/common/errorCode.js';
import { EmagineConstants } from '../../../src/constants/emagineConstants.js';
import { createJob } from '../../../src/models/job.js';
import { JobSearchQuery } from '../../../src/models/jobSearch.js';
import { EmagineJobSource } from '../../../src/services/sources/emagineJobSource.js';
import { HttpClient } from '../../../src/services/sources/httpClient.js';
import { connectionRefused, single, stubFetch, throwingFetch, timedOut } from '../../testDoubles.js';

// Trimmed from a real response from portal-api.emagine.org/api/JobAds/Search.
const SampleResponse = `
{
  "items": [
    {
      "id": 180255,
      "title": "C# Backend Engineer ",
      "startDate": "ASAP",
      "duration": "> 12 months",
      "requestId": 319731,
      "isPartTime": false,
      "jobAdWorkLocation": { "workLocationType": "Hybrid", "city": "London", "region": null, "country": "United Kingdom" },
      "area": { "id": 2137, "name": "Software Development" },
      "isJobSaved": false,
      "applicationDate": null
    },
    {
      "id": 180483,
      "title": "Développeur .net Angular (h/f)",
      "startDate": "ASAP",
      "duration": "> 12 months",
      "isPartTime": false,
      "jobAdWorkLocation": { "workLocationType": "Hybrid", "city": "Suresnes", "region": null, "country": "France" }
    },
    {
      "id": 180108,
      "title": "Separation Programme Planner",
      "startDate": "01.10.2026",
      "duration": null,
      "isPartTime": true,
      "jobAdWorkLocation": { "workLocationType": "Remote", "city": null, "region": null, "country": "United Kingdom" }
    },
    {
      "id": 180456,
      "title": "Dynamics 365 Consultant",
      "startDate": null,
      "duration": null,
      "isPartTime": false,
      "jobAdWorkLocation": null
    },
    {
      "id": 180300,
      "title": "Data Engineer",
      "startDate": null,
      "duration": null,
      "isPartTime": false,
      "jobAdWorkLocation": { "workLocationType": null, "city": "Leeds", "region": null, "country": "united kingdom" }
    },
    {
      "id": 179500,
      "title": "Client Delivery Director",
      "startDate": "ASAP",
      "duration": "Permanent Position",
      "isPartTime": false,
      "jobAdWorkLocation": { "workLocationType": "Hybrid", "city": "London", "region": null, "country": "United Kingdom" }
    }
  ],
  "totalCount": 6
}`;

function create({ status = 200, body = SampleResponse } = {}) {
  const handler = stubFetch(status, body);
  const http = new HttpClient(EmagineConstants.BaseAddress, handler);
  return { source: new EmagineJobSource(http), handler };
}

function createThrowing(error) {
  return new EmagineJobSource(new HttpClient(EmagineConstants.BaseAddress, throwingFetch(error)));
}

describe('EmagineJobSource', () => {
  it('SearchAsync_ValidQuery_PostsNewestFirstSearchForKeywords', async () => {
    const { source, handler } = create();

    await source.search(new JobSearchQuery(['.NET'], 7));

    const request = single(handler.requests);
    assert.equal(request.method, 'POST');
    assert.equal(request.url.toString(), 'https://portal-api.emagine.org/api/JobAds/Search');
    assert.match(request.headers.get('Content-Type'), /^application\/json/);

    const root = JSON.parse(request.body);
    assert.equal(root.skipCount, 0);
    assert.equal(root.maxResultCount, 500);
    assert.equal(root.sorting, 'CreationTime desc');
    assert.equal(root.supportedLanguageId, 'EN');

    const filter = root.filter;
    assert.deepEqual(filter.textFilters, ['.NET']);
    assert.equal(filter.isPartTime, null);
    assert.ok('isPartTime' in filter);
  });

  for (const property of [
    'workLocationTypes', 'workLocations', 'professionalRolesIds', 'consultantSeniorities',
    'languageProficiencies', 'industriesIds', 'recordIdsToExclude',
  ]) {
    it(`SearchAsync_AnyQuery_SendsRequiredFilterListsAsEmpty (${property})`, async () => {
      // The API rejects the search with 400 if any of these lists is missing.
      const { source, handler } = create();

      await source.search(new JobSearchQuery(['.NET'], 7));

      const list = JSON.parse(handler.requests[0].body).filter[property];
      assert.ok(Array.isArray(list));
      assert.equal(list.length, 0);
    });
  }

  it('SearchAsync_MixedCountries_KeepsOnlyUkJobs', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    // Drops France (180483), the advert with no location (180456) and the permanent role (179500);
    // country match ignores case (180300).
    assert.deepEqual(jobs.map((j) => j.id), ['180255', '180108', '180300']);
  });

  for (const duration of ['Permanent Position', 'permanent']) {
    it(`SearchAsync_PermanentDuration_DropsRole (${duration})`, async () => {
      const body = `
      { "items": [
        { "id": 1, "title": "Perm", "duration": "${duration}", "jobAdWorkLocation": { "country": "United Kingdom" } },
        { "id": 2, "title": "Contract", "duration": "4-6 months", "jobAdWorkLocation": { "country": "United Kingdom" } },
        { "id": 3, "title": "Unknown length", "duration": null, "jobAdWorkLocation": { "country": "United Kingdom" } }
      ] }`;
      const { source } = create({ body });

      const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

      assert.deepEqual(jobs.map((j) => j.id), ['2', '3']);
    });
  }

  it('SearchAsync_SampleResponse_MapsAllFields', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    const expected = createJob({
      source: 'emagine',
      id: '180255',
      title: 'C# Backend Engineer',
      company: null,
      location: 'London, United Kingdom (Hybrid)',
      dayRateMin: null,
      dayRateMax: null,
      rateIsEstimated: false,
      postedAt: null,
      url: 'https://portal.emagine.org/jobs/180255/c-backend-engineer',
      snippet: 'Start: ASAP · Duration: > 12 months',
    });
    assert.deepEqual(jobs[0], expected);
  });

  for (const [title, slug] of [
    ['Front Office Engineer (Java / React) – Equity', 'front-office-engineer-java-react-equity'],
    ['  .NET Developer  ', 'net-developer'],
    ['Développeur .net', 'd-veloppeur-net'],
    ['–', 'job'],  // a link without a slug redirects away from the job, so never leave it empty
  ]) {
    it(`SearchAsync_AnyTitle_LinksToJobPageWithSlug (${title.trim()})`, async () => {
      const body = `{ "items": [ { "id": 7, "title": ${JSON.stringify(title)}, "jobAdWorkLocation": { "country": "United Kingdom" } } ] }`;
      const { source } = create({ body });

      const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

      assert.equal(single(jobs).url, `https://portal.emagine.org/jobs/7/${slug}`);
    });
  }

  it('SearchAsync_PartialLocationAndSchedule_FormatsAvailableParts', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.equal(jobs[1].location, 'United Kingdom (Remote)');
    assert.equal(jobs[1].snippet, 'Start: 01.10.2026 · Part time');
    assert.equal(jobs[2].location, 'Leeds, united kingdom');
    assert.equal(jobs[2].snippet, null);
  });

  it('SearchAsync_SeveralKeywords_SearchesEachAndReturnsEachJobOnce', async () => {
    const { source, handler } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET', 'C#'], 7))).value;

    const textFilters = handler.requests.flatMap((r) => JSON.parse(r.body).filter.textFilters);
    assert.deepEqual(textFilters.sort(), ['.NET', 'C#']);
    assert.deepEqual(jobs.map((j) => j.id), ['180255', '180108', '180300']);
  });

  it('SearchAsync_ResponseHasNoItems_ReturnsEmpty', async () => {
    const { source } = create({ body: '{}' });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs, []);
  });

  it('SearchAsync_ErrorStatus_ReturnsHttpErrorWithUpstreamStatus', async () => {
    const { source } = create({ status: 400, body: '{}' });

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceHttpError, 400]);
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
