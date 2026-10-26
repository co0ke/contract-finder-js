/**
 * What Reed's search endpoint returns (the fields used).
 * @typedef {{ results?: ReedJob[] | null }} ReedResponse
 * @typedef {object} ReedJob
 * @property {number} jobId
 * @property {string} jobTitle
 * @property {string} [employerName]
 * @property {string} [locationName]
 * @property {number} [minimumSalary]
 * @property {number} [maximumSalary]
 * @property {string} [date] dd/MM/yyyy
 * @property {string} [jobDescription]
 * @property {string} jobUrl
 */
export {};
