import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createError } from '../../src/common/error.js';
import { ErrorCode } from '../../src/common/errorCode.js';
import { Result } from '../../src/common/result.js';

const Unavailable = createError(ErrorCode.StoreUnavailable, "Can't reach table storage.");

describe('Result', () => {
  it('Success_WithValue_HoldsValueAnd200', () => {
    const result = Result.success(42);

    assert.equal(result.isSuccess, true);
    assert.equal(result.value, 42);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.errors, []);
  });

  it('Success_WithoutValue_Is200WithNoErrors', () => {
    const result = Result.success();

    assert.equal(result.isSuccess, true);
    assert.equal(result.statusCode, 200);
    assert.deepEqual(result.errors, []);
  });

  it('Failure_WithErrors_HoldsErrorsAndStatus', () => {
    const second = createError(ErrorCode.SourceTimeout, 'Timed out.');

    const result = Result.failure(503, Unavailable, second);

    assert.equal(result.isSuccess, false);
    assert.equal(result.statusCode, 503);
    assert.deepEqual(result.errors, [Unavailable, second]);
  });

  it('Value_OnFailure_Throws', () => {
    const result = Result.failure(500, Unavailable);

    assert.throws(() => result.value, { message: /A failed result has no value \(StoreUnavailable/ });
  });

  it('Failure_NoErrors_Throws', () => {
    assert.throws(() => Result.failure(500), RangeError);
    assert.throws(() => Result.failure(500, []), RangeError);
  });

  it('Failure_FromAnotherResultsFailure_KeepsErrorsAndStatus', () => {
    const originalResult = Result.failure(401, Unavailable);

    const passedOnResult = Result.failure(originalResult.statusCode, originalResult.errors);

    assert.equal(passedOnResult.statusCode, 401);
    assert.deepEqual(passedOnResult.errors, originalResult.errors);
  });

  it('Match_OnSuccess_CallsSuccessBranchWithValue', () => {
    const outcome = Result.success(2).match((v) => `ok ${v}`, (_errors, status) => `failed ${status}`);

    assert.equal(outcome, 'ok 2');
  });

  it('Match_OnFailure_CallsFailureBranchWithErrorsAndStatus', () => {
    const outcome = Result.failure(503, Unavailable).match(() => 'ok', (errors, status) => `${status} ${errors[0].code}`);

    assert.equal(outcome, '503 StoreUnavailable');
  });

  it('Match_WithoutValue_CallsMatchingBranch', () => {
    assert.equal(Result.success().match(() => 'ok', () => 'failed'), 'ok');
    assert.equal(Result.failure(500, Unavailable).match(() => 'ok', () => 'failed'), 'failed');
  });

  it('Result_Constructed_IsImmutable', () => {
    const result = Result.success([1]);

    assert.throws(() => { result.statusCode = 500; }, TypeError);
    assert.throws(() => { result.errors.push(Unavailable); }, TypeError);
  });

  it('Error_Serialised_WritesCodeByName', () => {
    const json = JSON.stringify(createError(ErrorCode.StoreUnavailable, 'Down.'));

    assert.equal(json, '{"code":"StoreUnavailable","message":"Down."}');
  });

  it('Error_UnknownCode_Throws', () => {
    assert.throws(() => createError('NotACode', 'x'), TypeError);
  });
});
