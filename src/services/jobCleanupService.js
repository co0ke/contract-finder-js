import { CleanupConstants } from '../constants/cleanupConstants.js';

/**
 * @typedef {object} IJobCleanupService
 * @property {() => Promise<import('../common/result.js').Result<number>>} cleanUp
 *   Deletes stored adverts not seen for `CleanupConstants.RetentionMs`, and run history older than that.
 *   Returns how many entries were deleted.
 */

/** @implements {IJobCleanupService} */
export class JobCleanupService {
  #store;
  #time;

  /**
   * @param {import('./storage/jobStore.js').IJobStore} store
   * @param {import('./time.js').TimeProvider} time
   */
  constructor(store, time) {
    this.#store = store;
    this.#time = time;
  }

  cleanUp() {
    return this.#store.deleteOlderThan(new Date(this.#time.now().getTime() - CleanupConstants.RetentionMs));
  }
}
