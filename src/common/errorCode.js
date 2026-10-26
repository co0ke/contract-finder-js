/**
 * What went wrong, shared across layers and sources (the source's name travels separately).
 * Stored and serialised by name, so members can be reordered but renaming one orphans stored values.
 * @readonly
 * @enum {string}
 */
export const ErrorCode = Object.freeze({
  /** Never raised: catches uninitialised values and run history stored before codes existed. */
  Unknown: 'Unknown',

  DaysOutOfRange: 'DaysOutOfRange',
  TooManyKeywords: 'TooManyKeywords',
  KeywordTooLong: 'KeywordTooLong',

  StoreUnavailable: 'StoreUnavailable',

  SourceHttpError: 'SourceHttpError',
  SourceUnreachable: 'SourceUnreachable',
  SourceTimeout: 'SourceTimeout',
  SourceMissingCredentials: 'SourceMissingCredentials',
  SourceBlocked: 'SourceBlocked',
  SourceUnexpected: 'SourceUnexpected',
});

/** @param {string} value */
export const isErrorCode = (value) => Object.hasOwn(ErrorCode, value);
