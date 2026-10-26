/**
 * What techjobs.co.uk's search endpoint returns (the fields used).
 * @typedef {{ jobs?: TechJobsJob[] | null }} TechJobsResponse
 * @typedef {object} TechJobsJob
 * @property {string} id
 * @property {string} slug
 * @property {string} title
 * @property {string} [organizationName]
 * @property {string} [town]
 * @property {string} [city]
 * @property {string | number} [salaryMin] Sent as a string, e.g. "400.00".
 * @property {string | number} [salaryMax]
 * @property {string} [salaryType]
 * @property {string} [shortDescription]
 * @property {string} [postedAt] ISO 8601
 */
export {};
