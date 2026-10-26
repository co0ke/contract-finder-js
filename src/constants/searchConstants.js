export const SearchConstants = Object.freeze({
  // Broad on purpose: the search service's relevance rules decide what's listed.
  DefaultKeywords: Object.freeze(['.NET', 'C#', 'Azure', 'backend engineer', 'software engineer']),

  DefaultMaxDaysOld: 7,
  MaxAllowedDaysOld: 60,

  // Each keyword is a separate search on every source (up to 3 page requests on JobServe, which blocks busy clients).
  MaxKeywords: 10,
  MaxKeywordLength: 50,

  /** How much of an over-long keyword is quoted back in its error. */
  KeywordPreviewLength: 20,

  KeywordSeparator: ',',
});
