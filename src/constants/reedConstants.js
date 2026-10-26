export const ReedConstants = Object.freeze({
  Name: 'Reed',
  ResultsToTake: 100,

  /** The format of a result's `date`: dd/MM/yyyy. */
  DatePattern: /^(\d{2})\/(\d{2})\/(\d{4})$/,

  BaseAddress: new URL('https://www.reed.co.uk/api/1.0/'),
});
