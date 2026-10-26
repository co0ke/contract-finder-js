import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMockFetch } from '../src/mocks/mockFetch.js';

const Reed = 'https://www.reed.co.uk/api/1.0/search?keywords=.NET';
const Adzuna = 'https://api.adzuna.com/v1/api/jobs/gb/search/1?what=x';

const statuses = async (fetchImpl, url, times) => {
  const seen = [];
  for (let i = 0; i < times; i++) seen.push((await fetchImpl(url)).status);
  return seen;
};

describe('createMockFetch', () => {
  it('Fetch_KnownHost_AnswersFromFixtures', async () => {
    const response = await createMockFetch()(Reed);

    assert.equal(response.status, 200);
    assert.ok(Array.isArray((await response.json()).results));
  });

  it('Fetch_UnknownHost_FailsLikeAnUnreachableSite', async () => {
    await assert.rejects(createMockFetch()('https://nowhere.example/'), TypeError);
  });

  it('Fetch_FailingSource_FailsEveryTime', async () => {
    assert.deepEqual(await statuses(createMockFetch({ failingSources: ['Reed'] }), Reed, 3), [401, 401, 401]);
  });

  it('Fetch_FailingTechJobs_Answers503SoRetriesCanRunOut', async () => {
    const TechJobs = 'https://api.techjobs.co.uk/api/jobs/search?q=x';
    assert.deepEqual(await statuses(createMockFetch({ failingSources: ['TechJobs'] }), TechJobs, 3), [503, 503, 503]);
  });

  it('Fetch_FlakySource_FailsEachRequestTwiceThenAnswersIt_EveryTime', async () => {
    const fetchImpl = createMockFetch({ flakySources: ['Reed'] });

    // The same request (as a retry would re-send it), then the same search again later.
    assert.deepEqual(await statuses(fetchImpl, Reed, 3), [503, 503, 200]);
    assert.deepEqual(await statuses(fetchImpl, Reed, 3), [503, 503, 200]);
  });

  it('Fetch_FlakySource_CountsFailuresPerRequestNotPerSite', async () => {
    const fetchImpl = createMockFetch({ flakySources: ['Reed'] });

    const first = await fetchImpl(Reed);
    const other = await fetchImpl(`${Reed}&other=1`);

    assert.deepEqual([first.status, other.status], [503, 503]);
  });

  it('Fetch_FlakySource_LeavesOtherSitesAlone', async () => {
    assert.deepEqual(await statuses(createMockFetch({ flakySources: ['Reed'] }), Adzuna, 2), [200, 200]);
  });
});
