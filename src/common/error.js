import { ErrorCode, isErrorCode } from './errorCode.js';

/**
 * An expected failure. The code is serialised by name, e.g. `"code": "StoreUnavailable"`.
 * (Named AppError because `Error` is taken by JavaScript's exception type.)
 * @typedef {{ readonly code: keyof typeof ErrorCode, readonly message: string }} AppError
 */

/**
 * @param {keyof typeof ErrorCode} code
 * @param {string} message
 * @returns {AppError}
 */
export function createError(code, message) {
  if (!isErrorCode(code)) {
    throw new TypeError(`Unknown error code: ${code}`);
  }
  return Object.freeze({ code, message });
}
