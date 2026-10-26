import { SearchConstants } from '../constants/searchConstants.js';

/**
 * @typedef {object} SearchOptions
 * @property {ReadonlyArray<string> | null} keywords Overrides `SearchConstants.DefaultKeywords` when set, e.g. `Search__Keywords__0`.
 */

/** @param {Partial<SearchOptions>} [fields] @returns {SearchOptions} */
export const createSearchOptions = ({ keywords = null } = {}) =>
  Object.freeze({ keywords: keywords === null ? null : Object.freeze([...keywords]) });

// Keywords can contain spaces ("backend engineer"), so they're separated by commas.
/** @param {string} commaSeparated @returns {string[]} */
export const splitKeywordString = (commaSeparated) => splitKeywords(commaSeparated.split(SearchConstants.KeywordSeparator));

/**
 * Trimmed, non-blank, distinct ignoring case, in order of first appearance.
 * @param {Iterable<string>} keywords
 * @returns {string[]}
 */
export function splitKeywords(keywords) {
  const seen = new Set();
  const distinct = [];
  for (const raw of keywords) {
    const keyword = raw.trim();
    const key = keyword.toUpperCase();
    if (keyword.length > 0 && !seen.has(key)) {
      seen.add(key);
      distinct.push(keyword);
    }
  }
  return distinct;
}

/**
 * The keywords searched when none are requested: the configured ones, else `SearchConstants.DefaultKeywords`.
 * @param {SearchOptions} options
 * @returns {ReadonlyArray<string>}
 */
export function effectiveKeywords(options) {
  const configured = splitKeywords(options.keywords ?? []);
  return configured.length > 0 ? configured : SearchConstants.DefaultKeywords;
}
