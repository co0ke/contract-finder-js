/**
 * What Adzuna's search endpoint returns (the fields used).
 * @typedef {{ results?: AdzunaJob[] | null }} AdzunaResponse
 * @typedef {object} AdzunaJob
 * @property {string} id
 * @property {string} title
 * @property {string} [description]
 * @property {string} [created] ISO 8601
 * @property {string} redirect_url
 * @property {number} [salary_min]
 * @property {number} [salary_max]
 * @property {boolean | string | number} [salary_is_predicted] Documented as a boolean, but the live API returns "0"/"1" strings.
 * @property {{ display_name?: string }} [company]
 * @property {{ display_name?: string }} [location]
 */
export {};
