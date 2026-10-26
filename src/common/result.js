import { HttpStatus } from './httpStatus.js';

/**
 * The outcome of an operation that can fail in an expected way. Genuinely exceptional failures still throw.
 *
 * `statusCode` is the upstream HTTP status where there is one (e.g. 401 from a job site), otherwise
 * 500 for adapter failures or 400 for invalid input. It's what went wrong, not what our API responds with:
 * the function maps it.
 *
 * One class covers both the C# `Result` and `Result<T>`: a success without a value simply has `value` undefined.
 * @template T
 */
export class Result {
  static SuccessStatus = HttpStatus.Ok;

  /** @type {T} */
  #value;

  /**
   * @private Use {@link Result.success} or {@link Result.failure}.
   * @param {number} statusCode
   * @param {ReadonlyArray<import('./error.js').AppError>} errors
   * @param {T} value
   */
  constructor(statusCode, errors, value) {
    this.statusCode = statusCode;
    /** Empty on success; at least one on failure. */
    this.errors = Object.freeze([...errors]);
    this.#value = value;
    Object.freeze(this);
  }

  /**
   * @template T
   * @param {T} [value]
   * @returns {Result<T>}
   */
  static success(value) {
    return new Result(Result.SuccessStatus, [], value);
  }

  /**
   * A failure; also how another result's failure is passed on as a result of a different type.
   * A failure without an error is a bug in the caller, not an expected failure, so it throws.
   * @param {number} statusCode
   * @param {...(import('./error.js').AppError | ReadonlyArray<import('./error.js').AppError>)} errors
   * @returns {Result<never>}
   */
  static failure(statusCode, ...errors) {
    const flat = errors.flat();
    if (flat.length === 0) {
      throw new RangeError('A failure needs at least one error.');
    }
    return new Result(statusCode, flat, undefined);
  }

  get isSuccess() {
    return this.errors.length === 0;
  }

  /** The value; reading it from a failure is a bug and throws. */
  get value() {
    if (!this.isSuccess) {
      throw new Error(`A failed result has no value (${this.errors[0].code}: ${this.errors[0].message}).`);
    }
    return this.#value;
  }

  /**
   * @template TOut
   * @param {(value: T) => TOut} onSuccess
   * @param {(errors: ReadonlyArray<import('./error.js').AppError>, statusCode: number) => TOut} onFailure
   * @returns {TOut}
   */
  match(onSuccess, onFailure) {
    return this.isSuccess ? onSuccess(this.#value) : onFailure(this.errors, this.statusCode);
  }
}
