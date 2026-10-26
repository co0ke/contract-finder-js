/**
 * The body of a JobAds/Search request. Every list in the filter is required by the API, even when empty.
 * @param {object} fields
 * @param {number} fields.skipCount
 * @param {number} fields.maxResultCount
 * @param {string} fields.sorting
 * @param {string[]} fields.textFilters
 * @param {string} fields.supportedLanguageId
 */
export function createEmagineSearchRequest({ skipCount, maxResultCount, sorting, textFilters, supportedLanguageId }) {
  return {
    skipCount,
    maxResultCount,
    sorting,
    filter: {
      textFilters,
      isPartTime: null,
      workLocationTypes: [],
      workLocations: [],
      professionalRolesIds: [],
      consultantSeniorities: [],
      languageProficiencies: [],
      industriesIds: [],
      recordIdsToExclude: [],
    },
    supportedLanguageId,
  };
}

/**
 * What JobAds/Search returns (the fields used).
 * @typedef {{ items?: EmagineJob[] | null }} EmagineResponse
 * @typedef {object} EmagineJob
 * @property {number} id
 * @property {string} title
 * @property {string} [startDate]
 * @property {string} [duration]
 * @property {boolean} [isPartTime]
 * @property {EmagineLocation | null} [jobAdWorkLocation]
 * @typedef {object} EmagineLocation
 * @property {string | null} [workLocationType]
 * @property {string | null} [city]
 * @property {string | null} [region]
 * @property {string | null} [country]
 */
