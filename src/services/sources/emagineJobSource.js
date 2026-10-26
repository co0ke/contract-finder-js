import { Result } from '../../common/result.js';
import { isBlank } from '../../common/strings.js';
import { EmagineConstants } from '../../constants/emagineConstants.js';
import { createJob } from '../../models/job.js';
import { createEmagineSearchRequest } from './dtos/emagineDtos.js';
import { SourceFailures } from './sourceFailures.js';

/**
 * UK freelance roles from emagine's consultant portal (https://portal.emagine.org/jobs/all).
 * There is no documented API; this uses the unauthenticated search endpoint the portal itself calls.
 * @implements {import('./jobSource.js').IJobSource}
 */
export class EmagineJobSource {
  #http;

  /** @param {import('./httpClient.js').HttpClient} http */
  constructor(http) {
    this.#http = http;
  }

  get name() {
    return EmagineConstants.Name;
  }

  /** @param {import('../../models/jobSearch.js').JobSearchQuery} query */
  async search(query) {
    // One search per keyword: how the API combines several text filters is undocumented.
    const searches = query.keywords.map((keyword) => this.#searchKeyword(keyword));

    // Adverts carry no posted date, so maxDaysOld can't be applied.
    return SourceFailures.combine(await Promise.all(searches));
  }

  /** @param {string} keyword */
  async #searchKeyword(keyword) {
    const request = createEmagineSearchRequest({
      skipCount: 0,
      maxResultCount: EmagineConstants.ResultsToTake,
      sorting: EmagineConstants.Sorting,
      textFilters: [keyword],
      supportedLanguageId: EmagineConstants.SupportedLanguageId,
    });

    let response;
    try {
      response = await this.#http.postJson('JobAds/Search', request);
    } catch (error) {
      return SourceFailures.fromFetchError(this.name, error);
    }

    if (!response.ok) {
      return SourceFailures.httpError(this.name, response);
    }
    /** @type {import('./dtos/emagineDtos.js').EmagineResponse} */
    const body = await response.json();

    return Result.success((body?.items ?? [])
      .filter((j) => j.jobAdWorkLocation?.country?.toLowerCase() === EmagineConstants.Country.toLowerCase())
      // emagine also lists permanent roles, marked only by a duration of "Permanent Position".
      .filter((j) => !(j.duration?.toLowerCase().includes(EmagineConstants.PermanentDuration) ?? false))
      .map((j) => this.#toJob(j)));
  }

  /** @param {import('./dtos/emagineDtos.js').EmagineJob} j */
  #toJob(j) {
    return createJob({
      source: this.name,
      id: String(j.id),
      title: j.title.trim(),
      company: null,
      location: formatLocation(j.jobAdWorkLocation),
      dayRateMin: null,
      dayRateMax: null,
      rateIsEstimated: false,
      postedAt: null,
      // The job page is /jobs/{id}/{slug}. Any slug works, but without one the portal redirects
      // to sign-in, or into the consultant area when logged in.
      url: new URL(`jobs/${j.id}/${slug(j.title)}`, EmagineConstants.PortalAddress).toString(),
      snippet: formatSnippet(j),
    });
  }
}

// "C# Backend Engineer" becomes "c-backend-engineer", matching the portal's own links.
/** @param {string} title */
function slug(title) {
  const value = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return value.length > 0 ? value : EmagineConstants.FallbackSlug;
}

// Only called for UK adverts, so there is always at least a country.
/** @param {import('./dtos/emagineDtos.js').EmagineLocation} l */
function formatLocation(l) {
  const place = [l.city, l.region, l.country].filter((p) => !isBlank(p)).join(', ');
  return isBlank(l.workLocationType) ? place : `${place} (${l.workLocationType})`;
}

/** @param {import('./dtos/emagineDtos.js').EmagineJob} j */
function formatSnippet(j) {
  const parts = [
    isBlank(j.startDate) ? null : `Start: ${j.startDate}`,
    isBlank(j.duration) ? null : `Duration: ${j.duration}`,
    j.isPartTime ? 'Part time' : null,
  ];
  const snippet = parts.filter((p) => p !== null).join(' · ');
  return snippet.length > 0 ? snippet : null;
}
