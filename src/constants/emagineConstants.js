export const EmagineConstants = Object.freeze({
  Name: 'emagine',

  // Only UK roles are wanted. The API's own location filter takes internal ids, so filter on the
  // country name instead, fetching enough results that UK adverts aren't lost beyond the first page.
  Country: 'United Kingdom',
  ResultsToTake: 500,

  Sorting: 'CreationTime desc',
  SupportedLanguageId: 'EN',

  /** emagine also lists permanent roles, marked only by a duration containing this. */
  PermanentDuration: 'permanent',

  /** The slug used when a title has no letters or digits to make one from. */
  FallbackSlug: 'job',

  BaseAddress: new URL('https://portal-api.emagine.org/api/'),
  PortalAddress: new URL('https://portal.emagine.org/'),
});
