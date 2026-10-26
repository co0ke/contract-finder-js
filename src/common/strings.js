/**
 * string.IsNullOrWhiteSpace: true for null, undefined and strings with no visible characters.
 * @param {unknown} value
 */
export const isBlank = (value) => value === null || value === undefined || String(value).trim().length === 0;
