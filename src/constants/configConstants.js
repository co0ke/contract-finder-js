/** Configuration section names, which are also the prefixes of the app settings (e.g. `Adzuna__AppId`). */
export const ConfigConstants = Object.freeze({
  SearchSection: 'Search',
  JobStoreSection: 'JobStore',
  AdzunaSection: 'Adzuna',
  ReedSection: 'Reed',

  /** Setting that switches the store and the job sites to in-process mocks. On unless set to "false". */
  MockExternalsSetting: 'MOCK_EXTERNALS',
});
