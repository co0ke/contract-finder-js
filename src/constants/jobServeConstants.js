export const JobServeConstants = Object.freeze({
  Name: 'JobServe',

  // The search only understands country-level locations ("London" returns an empty page).
  Country: 'United Kingdom',

  // JobServe silently blocks clients that make many requests, so only fetch the most relevant pages
  // for each keyword, one request at a time.
  MaxPages: 3,

  /** Posted dates are UK local time. */
  UkTimeZoneId: 'Europe/London',

  /** dd/MM/yyyy HH:mm:ss */
  DatePattern: /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/,

  /** Types are Contract, Permanent, Contract/Permanent and Part Time/Temporary/Seasonal. */
  ContractType: 'Contract',

  CompanyLabels: Object.freeze(['Company', 'Employment Business', 'Employment Agency']),

  BaseAddress: new URL('https://www.jobserve.com/gb/en/'),
});
