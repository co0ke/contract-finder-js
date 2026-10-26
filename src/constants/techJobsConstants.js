export const TechJobsConstants = Object.freeze({
  Name: 'TechJobs',
  ResultsToTake: 50,

  // Contract work is tagged by IR35 status; "contract" matches nothing. The list must be comma
  // separated, because repeated parameters are ignored.
  ContractJobTypes: 'inside-ir35,outside-ir35',

  /** The `salaryType` of a day rate; annual figures on contract roles are usually the recruiter's ceiling. */
  DailySalaryType: 'daily',

  /** Shown when an advert names neither a town nor a city. */
  FallbackLocation: 'United Kingdom',

  JobUrlPrefix: 'https://www.techjobs.co.uk/jobs/',

  BaseAddress: new URL('https://api.techjobs.co.uk/'),
});
