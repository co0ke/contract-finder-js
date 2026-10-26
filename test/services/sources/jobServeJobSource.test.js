import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ErrorCode } from '../../../src/common/errorCode.js';
import { JobServeConstants } from '../../../src/constants/jobServeConstants.js';
import { createJob } from '../../../src/models/job.js';
import { JobSearchQuery } from '../../../src/models/jobSearch.js';
import { HttpClient } from '../../../src/services/sources/httpClient.js';
import { JobServeJobSource } from '../../../src/services/sources/jobServeJobSource.js';
import { RetryPolicy } from '../../../src/services/sources/retryPolicy.js';
import { connectionRefused, fixedTime, single, stubFetch, throwingFetch, timedOut, utc } from '../../testDoubles.js';

const Now = utc(2026, 9, 25, 12, 0, 0);

// Trimmed from a real ".NET" results page: a contract, a permanent role and an older contract.
const SampleItems = `
<div class="jobListItem newjobsum" id="8F26A5460F70CE6D02"><div class="jobListHeaderPanel"><a href="/gb/en/find-jobs-in-United-Kingdom/DOTNET-AZURE-DEVELOPER-CONTRACT-REMOTE-INSIDE-IR35-8F26A5460F70CE6D02/" title="Click here to view this .Net Azure Developer - contract - remote - inside IR35 job" class="jobListPosition">.Net Azure Developer - contract - remote - inside IR35</a></div>
<div class="jobListDetailsPanel"><label class="jobListLabel left ">Location</label><span id="summlocation" class="jobListDetail left" title="Remote , UK">Remote , UK</span><label class="jobListLabel left ">Rate</label><span id="summrate" class="jobListDetail left" title="£325/Day">£325/Day</span><label class="jobListLabel left ">Type</label><span id="summtype" class="jobListDetail left" title="Contract">Contract</span><label class="jobListLabel left">Industry</label><span class="jobListDetail left"><a href="/gb/en/IT+Telecommunications-sector-jobs-in-United-Kingdom/">IT</a></span><label class="jobListLabel left">Employment Business</label><span class="jobListDetail left"><a href="/gb/en/Redirect/DirectoryUrl.jsrs?id=9A75264223" title="View more information about TrinIT Talent Ltd" target="_blank">TrinIT Talent Ltd</a></span></div>
<div class="jobListSkillsPanel"><p class="jobListSkills">TrinIT Talent are looking for a .NET Azure Developer to come on board for a 6 month contract...&nbsp; <a href="W8F26A5460F70CE6D02.jsjob" title="Click here for full job details">more&nbsp;-&gt;</a></p><label class="jobListLabel left ">Posted Date</label><span id="summposteddate" class="jobListDetail left" title="22/09/2026 17:06:26">22/09/2026 17:06:26</span></div></div>
<div class="jobListItem newjobsum" id="18688A4E94EEC628F7"><div class="jobListHeaderPanel"><a href="/gb/en/search-jobs-in-Southampton,-Hampshire,-United-Kingdom/DOTNET-DEVELOPER-18688A4E94EEC628F7/" class="jobListPosition">.Net Developer</a></div>
<div class="jobListDetailsPanel"><label class="jobListLabel left ">Location</label><span id="summlocation" class="jobListDetail left">Southampton/Remote, UK</span><label class="jobListLabel left ">Rate</label><span id="summrate" class="jobListDetail left">£55k-60k</span><label class="jobListLabel left ">Type</label><span id="summtype" class="jobListDetail left">Permanent</span></div>
<div class="jobListSkillsPanel"><p class="jobListSkills">.NET Developer - .NET/C#/APIs...</p><label class="jobListLabel left ">Posted Date</label><span id="summposteddate" class="jobListDetail left">21/09/2026 17:04:14</span></div></div>
<div class="jobListItem newjobsum" id="F827AF2E80CF7D71E8"><div class="jobListHeaderPanel"><a href="/gb/en/search-jobs-in-Wokingham,-Berkshire,-United-Kingdom/DOTNET-FULL-STACK-DEVELOPER-AZURE-AND-REACT-F827AF2E80CF7D71E8/" class="jobListPosition">.NET Full-Stack Developer (Azure and React)</a></div>
<div class="jobListDetailsPanel"><label class="jobListLabel left ">Location</label><span id="summlocation" class="jobListDetail left">Wokingham, UK</span><label class="jobListLabel left ">Type</label><span id="summtype" class="jobListDetail left">Contract</span><label class="jobListLabel left">Employment Business</label><span class="jobListDetail left"><a href="#">Project Recruit</a></span></div>
<div class="jobListSkillsPanel"><p class="jobListSkills">.NET Full-Stack Developer (Azure and React)...</p><label class="jobListLabel left ">Posted Date</label><span id="summposteddate" class="jobListDetail left">10/09/2026 18:14:24</span></div></div>
`;

const PagingToPage6 = `
<div id="jobListPagingControl" class="jobListPagingControl"><span class="nav_Num"><span class="Small onpagehighlight">1</span><a href="/gb/en/JobListing.aspx?shid=37CB3DD1C7D8FF6FF51C&amp;lq=United+Kingdom&amp;q=.NET&amp;mq=&amp;js=1&amp;page=2" class="Small notonpage">2</a></span><span class="nav_Next"><a href="/gb/en/JobListing.aspx?shid=37CB3DD1C7D8FF6FF51C&amp;lq=United+Kingdom&amp;q=.NET&amp;mq=&amp;js=1&amp;page=2" title="Next Page">next</a></span><span class="nav_Last"><a href="/gb/en/JobListing.aspx?shid=37CB3DD1C7D8FF6FF51C&amp;lq=United+Kingdom&amp;q=.NET&amp;mq=&amp;js=1&amp;page=6" title="Last Page">last</a></span></div>
`;

const page = (paging = '') =>
  `<html><body><form id="frm1">${paging}<div id="joblistingcollection">${SampleItems}</div></form></body></html>`;

function create({ status = 200, body = null } = {}) {
  const handler = stubFetch(status, body ?? page(), 'text/html; charset=utf-8');
  const http = new HttpClient(JobServeConstants.BaseAddress, handler);
  return { source: new JobServeJobSource(http, fixedTime(Now)), handler };
}

function createThrowing(error) {
  return new JobServeJobSource(new HttpClient(JobServeConstants.BaseAddress, throwingFetch(error)), fixedTime(Now));
}

describe('JobServeJobSource', () => {
  it('SearchAsync_ValidQuery_SearchesUkWithKeywords', async () => {
    const { source, handler } = create();

    await source.search(new JobSearchQuery(['.NET'], 7));

    const request = single(handler.requests);
    assert.equal(request.url.pathname, '/gb/en/JobListing.aspx');
    assert.equal(request.url.searchParams.get('q'), '.NET');
    assert.equal(request.url.searchParams.get('lq'), 'United Kingdom');
  });

  it('SearchAsync_SamplePage_MapsAllFields', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    const expected = createJob({
      source: 'JobServe',
      id: '8F26A5460F70CE6D02',
      title: '.Net Azure Developer - contract - remote - inside IR35',
      company: 'TrinIT Talent Ltd',
      location: 'Remote , UK',
      dayRateMin: 325,
      dayRateMax: 325,
      rateIsEstimated: false,
      // Posted 17:06 UK time, which is BST in September.
      postedAt: utc(2026, 9, 22, 16, 6, 26),
      url: 'https://www.jobserve.com/gb/en/find-jobs-in-United-Kingdom/DOTNET-AZURE-DEVELOPER-CONTRACT-REMOTE-INSIDE-IR35-8F26A5460F70CE6D02/',
      snippet: 'TrinIT Talent are looking for a .NET Azure Developer to come on board for a 6 month contract...',
    });
    assert.deepEqual(jobs[0], expected);
  });

  it('SearchAsync_PermanentJob_DropsIt', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 30))).value;

    assert.deepEqual(jobs.map((j) => j.id), ['8F26A5460F70CE6D02', 'F827AF2E80CF7D71E8']);
  });

  it('SearchAsync_JobsOlderThanMaxDaysOld_DropsThem', async () => {
    const { source } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs.map((j) => j.id), ['8F26A5460F70CE6D02']);
  });

  it('SearchAsync_SeveralKeywords_SearchesEachInTurnAndReturnsEachJobOnce', async () => {
    const { source, handler } = create();

    const jobs = (await source.search(new JobSearchQuery(['.NET', 'C#'], 7))).value;

    assert.deepEqual(handler.requests.map((r) => r.url.searchParams.get('q')), ['.NET', 'C#']);
    assert.equal(jobs.length, 1);
  });

  it('SearchAsync_SeveralKeywordsWithManyPages_FetchesMaxPagesForEach', async () => {
    const { source, handler } = create({ body: page(PagingToPage6) });

    await source.search(new JobSearchQuery(['.NET', 'C#'], 7));

    assert.equal(handler.requests.length, 2 * JobServeConstants.MaxPages);
  });

  it('SearchAsync_NoPagingLinks_FetchesOnePage', async () => {
    const { source, handler } = create();

    await source.search(new JobSearchQuery(['.NET'], 7));

    assert.equal(handler.requests.length, 1);
  });

  it('SearchAsync_MorePagesThanMax_FetchesOnlyFirstPagesOfSavedSearch', async () => {
    const { source, handler } = create({ body: page(PagingToPage6) });

    await source.search(new JobSearchQuery(['.NET'], 7));

    assert.equal(handler.requests.length, JobServeConstants.MaxPages);
    const later = handler.requests.slice(1).map((r) => r.url.searchParams);
    for (const q of later) {
      assert.equal(q.get('shid'), '37CB3DD1C7D8FF6FF51C');
    }
    assert.deepEqual(later.map((q) => q.get('page')), ['2', '3']);
    assert.deepEqual(handler.requests.slice(1).map((r) => r.url.pathname), ['/gb/en/JobListing.aspx', '/gb/en/JobListing.aspx']);
  });

  it('SearchAsync_FewerPagesThanMax_FetchesThemAll', async () => {
    const twoPages = PagingToPage6.replaceAll('page=6', 'page=2');
    const { source, handler } = create({ body: page(twoPages) });

    await source.search(new JobSearchQuery(['.NET'], 7));

    assert.equal(handler.requests.length, 2);
  });

  it('SearchAsync_SameJobOnSeveralPages_ReturnsItOnce', async () => {
    // The stub returns the same page every time.
    const { source } = create({ body: page(PagingToPage6) });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.equal(jobs.length, 1);
  });

  it('SearchAsync_EmptyPage_ReturnsBlocked', async () => {
    // What JobServe sends, with a 200, once it starts blocking a client.
    const { source } = create({ body: '\uFEFF<html>\r\n<head>\r\n    <title></title>\r\n</head>\r\n<body>\r\n\r\n</body>\r\n</html>' });

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceBlocked, 500]);
  });

  it('SearchAsync_BlockedWithRetryPolicy_DoesNotRetry', async () => {
    // Retrying while blocked only makes the block worse; the page is a 200, so the policy leaves it alone.
    const handler = stubFetch(200, '<html><body></body></html>', 'text/html');
    const retry = new RetryPolicy({ sleep: async () => {} });
    const source = new JobServeJobSource(new HttpClient(JobServeConstants.BaseAddress, handler, { retry }), fixedTime(Now));

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.equal(single(result.errors).code, ErrorCode.SourceBlocked);
    assert.equal(handler.requests.length, 1);
  });

  it('SearchAsync_PageWithNoJobs_ReturnsEmpty', async () => {
    const { source } = create({ body: page().replace(SampleItems, '') });

    const jobs = (await source.search(new JobSearchQuery(['.NET'], 7))).value;

    assert.deepEqual(jobs, []);
  });

  it('SearchAsync_ErrorStatus_ReturnsHttpErrorWithUpstreamStatus', async () => {
    const { source } = create({ status: 503, body: 'error' });

    const result = await source.search(new JobSearchQuery(['.NET'], 7));

    assert.deepEqual([single(result.errors).code, result.statusCode], [ErrorCode.SourceHttpError, 503]);
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
