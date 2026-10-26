/**
 * Runs daily, deleting adverts not seen for three weeks and run history older than that.
 *
 * @param {object} deps
 * @param {import('../services/jobCleanupService.js').IJobCleanupService} deps.cleanup
 * @param {import('../services/logger.js').Logger} deps.logger
 * @returns {(timer?: unknown) => Promise<void>}
 */
export function createCleanUpJobsHandler({ cleanup, logger }) {
  return async function cleanUpJobs() {
    const result = await cleanup.cleanUp();
    if (result.isSuccess) {
      logger.info(`Cleanup deleted ${result.value} entries.`);
    } else {
      logger.warn(`Cleanup failed: ${result.errors[0].code}.`);
    }
  };
}
