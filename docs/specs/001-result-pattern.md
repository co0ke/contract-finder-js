# Spec 001: Result pattern for expected failures

**Status:** Approved (2026-09-27)
**Date:** 2026-09-27

## Problem

Two goals, equal weight:

1. **Learn and showcase the pattern:** this codebase should be an idiomatic, well-tested example of a hand-rolled Result type.
2. **Remove exception-driven control flow:** expected failures are currently thrown and caught (the `try/catch` in `GetJobs`, the catch-all in `JobSearchService`, `JobStoreUnavailableException`).

**Success looks like:**

- Expected failures are values returned through `Result`, and exceptions are reserved for genuinely exceptional circumstances.
- A `catch` is allowed only where a third-party API throws for an expected failure (`HttpClient`, `Azure.Data.Tables`), and it converts the exception to a `Result` right there. There is no other `catch`, except the one per-source safety net in `JobSearchService`.

Expected failures currently travel three different ways:

- `GetJobs` returns `BadRequestObjectResult` inline for invalid `days` / keywords.
- Sources throw (`EnsureSuccessStatusCode`, JobServe's empty-page `HttpRequestException`, `InvalidOperationException` for missing credentials); `JobSearchService` catches everything except caller cancellation and flattens it to `SourceStatus.Error` (a string).
- `TableJobStore` throws `JobStoreUnavailableException`; `GetJobs` catches it and returns 503.

## Scope

### In

- A hand-rolled `Result` / `Result<T>` type (no NuGet package), in keeping with the small stack in `CLAUDE.md`.
- Applied across **all layers**: sources (`IJobSource`), store (`IJobStore`), service (`IJobSearchService`) and function (`GetJobs`).

### Out

- Third-party result libraries (ErrorOr, FluentResults, Ardalis.Result, OneOf, …).

## Domain Model

- **Location:** a new top-level **`Common/`** folder holds `Result`, `Error` and `ErrorCode`. This extends the `CLAUDE.md` layering (`Functions/`, `Services/`, `Models/`), and `CLAUDE.md` must be updated to match.
- **Error:** `Error(ErrorCode Code, string Message)`: a code and a message only, with no kind/category field and no subtype hierarchy. (Chosen over a kind enum and over a closed hierarchy.)
- **Error codes:** a single **`ErrorCode` enum**, shared across sources (the source name is already on the `SourceStatus` entry). It's serialised to JSON as the member name (a converter on `Error.Code` only) and stored in table storage as the name. Enum names can't contain dots, so the `Area.Reason` idea is written as `AreaReason`. `Unknown = 0` is never raised; it catches uninitialised values and legacy rows.

  | Code | Raised by | Status on Result |
  |---|---|---|
  | `DaysOutOfRange` | `GetJobs` | 400 |
  | `TooManyKeywords` | `GetJobs` | 400 |
  | `KeywordTooLong` | `GetJobs` | 400 |
  | `StoreUnavailable` | `TableJobStore` | 500 |
  | `SourceHttpError` | any source, non-2xx | upstream status |
  | `SourceUnreachable` | any source, no response | 500 |
  | `SourceTimeout` | any source, HttpClient timeout | 500 |
  | `SourceMissingCredentials` | Adzuna, Reed | 500 |
  | `SourceBlocked` | JobServe, 200 with empty body | 500 |
  | `SourceUnexpected` | `JobSearchService` safety net | 500 |

- **Result API (core + Match):** `IsSuccess`, `Value` (throws `InvalidOperationException` if read on a failure, since that's a bug), `Errors`, `StatusCode`, factories `Success(value)` / `Failure(status, errors)`, implicit conversion from `T`, and `Match(onSuccess, onFailure)`. No `Map`/`Bind` until there's a need.
- **`Result` and `Result<T>`:** a non-generic `Result` serves void operations (e.g. `IJobStore.UpsertAsync`), and `Result<T>` derives from it.
- **Errors and status:** a Result carries an **`Errors` collection** (not a single error) and an **`int` HTTP status** on the result itself. It's an `int` rather than `HttpStatusCode`, so it isn't limited to that enum's members. Success is always `200`. A failure must have at least one error; creating one without is a bug and throws. The status itself isn't checked (changed after approval, 2026-09-27): success is decided by `Errors` alone, and the status is whatever the caller passes.
  - The status is the **upstream** status where there is one (e.g. `401` from Reed), not our API's response status. `GetJobs` maps it to our response status. The status therefore appears in the services and adapters layers, a deliberate departure from "HTTP shaping lives in `Functions/`" that `CLAUDE.md` should record.
  - Failures with **no usable upstream status** carry `500`, and the error code says what happened. That covers network failure, timeout, missing credentials, JobServe's 200-with-empty-body block and store unreachable. So in practice a failed Result never carries 200, though nothing enforces it.
  - **Exception:** a `GetJobs` validation failure carries `400`, because it's our own judgement of the caller's input. The "500 when there's no upstream status" rule applies only to adapter failures (sources and store).
- **Throw vs return:** exceptions are for genuinely exceptional circumstances only. These become returned `Result`s:
  - invalid input to `GetJobs` (`days`, keywords);
  - table storage unreachable (replaces `JobStoreUnavailableException`);
  - non-2xx responses from any source, and JobServe's 200-with-empty-body block;
  - network failures and HTTP timeouts (no response at all);
  - missing source credentials (Adzuna, Reed).
- **Still exceptions:** bugs, and anything not listed above (e.g. JSON/HTML that doesn't parse after a layout change).
- **Safety net:** `JobSearchService` keeps a per-source catch as a last-resort boundary so one broken source never hides the others. It logs the exception at error level and records the source as failed with `SourceUnexpected`, status 500 and a generic message ("Unexpected error searching Reed."). Exception details go to the log only. It is never the path for an expected failure.

## API Contract

- The public contract **may change**: error response bodies can be redesigned and the UI (`wwwroot/index.html`) updated to match.
- Error bodies are always `{ "errors": [ { "code": "...", "message": "..." } ] }`, even for a single error (replacing `{ error }`).
- `GetJobs` validation collects **every** error rather than stopping at the first one.
- `IJobSearchService.SearchAsync` returns `Result<JobSearchResult>`. Only an unreachable store fails it. Source failures stay per-source inside a successful `JobSearchResult`.
- `GetJobs` maps to our response status as follows:
  - our own validation → **400**;
  - a failed service Result (store unreachable) → **503**;
  - every source failed → **502**, with the full `JobSearchResult` in the body (as today);
  - otherwise → **200**.
  - An upstream status from a source (401, 429, 500…) is **never** passed through as our status. It only appears on that source's entry in the body.
- Each entry in `sources` is `{ name, count, warning, upstreamStatus, errors: [ { code, message } ] }`. `upstreamStatus` and `errors` are present only when the source failed. `SourceRun` history stores the first error's code and message.

## Authorization

Unchanged: function keys (`AuthorizationLevel.Function`) on `GetJobs`.

## Edge Cases & Failure Modes

- **Several keywords fail on one source** (Adzuna, Reed and emagine search keywords in parallel): if any keyword fails, the source fails. Every failed keyword's errors are collected, and the status comes from the first failure.
- **JobServe paging:** pages are fetched one at a time; the first failed page ends the source with that failure.
- **Store fails part-way through a search** (e.g. `GetRecentRunsAsync` works, then `UpsertAsync` fails): the service returns that failure straight away (fail fast → 503). Adverts fetched in this run are discarded. There are no retries.
- **Timeouts:** an HttpClient timeout (`TaskCanceledException` with an inner `TimeoutException`) becomes `SourceTimeout`. There's no caller cancellation: signatures take no `CancellationToken` (changed after approval, 2026-09-27), so the safety net catches every exception.
- **Legacy run history:** rows written before this change have no error code. They're read as `ErrorCode.Unknown` with their stored message, so source health keeps working.
- **Several validation errors:** they're all reported together. Each over-long keyword gets its own `KeywordTooLong` error.

## Non-Functional Requirements

None beyond today's. Returning a Result adds negligible overhead compared with the HTTP calls.

## Integrations

Unchanged. The same four job sites and Azure Table Storage; only how their failures are reported changes. The runs table gains an `ErrorCode` column.

## Acceptance Criteria

**Result type**

- **AC-1:** Given `Result<T>.Success(v)`, then `IsSuccess` is true, `Value` is `v`, `StatusCode` is 200 and `Errors` is empty.
- **AC-2:** Given a failure, when `Value` is read, then it throws `InvalidOperationException`.
- **AC-3:** When a failure is created with no errors, then it throws `ArgumentException`. (Amended 2026-09-27: the status is no longer checked.)
- **AC-4:** Given a value of `T`, when it's assigned to `Result<T>`, then it's a success holding that value.
- **AC-5:** `Match` calls the success branch with the value, or the failure branch with the errors and the status.

**Sources**

- **AC-6:** Given Adzuna or Reed credentials are missing, when searching, then the result is a failure (`SourceMissingCredentials`, 500) and no request is sent.
- **AC-7:** Given a source responds with a non-2xx status (e.g. 401), then the result is a failure (`SourceHttpError`) with that status.
- **AC-8:** Given no response (a connection failure), then the result is a failure (`SourceUnreachable`, 500).
- **AC-9:** Given an HttpClient timeout, then the result is a failure (`SourceTimeout`, 500).
- **AC-10:** _Withdrawn (2026-09-27): `CancellationToken` was removed from all signatures, so there is no caller cancellation to propagate._
- **AC-11:** Given JobServe returns 200 with an empty body, then the result is a failure (`SourceBlocked`, 500).
- **AC-12:** Given two keywords fail on one source, then the failure has both errors and the first failure's status.

**Store**

- **AC-13:** Given table storage is unreachable, when any store method is called, then it returns a failure (`StoreUnavailable`, 500) with the Azurite hint, and doesn't throw.
- **AC-14:** Given a `SourceRun` with an error, when it's recorded and read back, then the code and message round-trip; a row with no code reads as `Unknown`.

**Service**

- **AC-15:** Given a source returns a failure, then its `SourceStatus` has that `UpstreamStatus` and those `Errors`, and the other sources' adverts are still listed.
- **AC-16:** Given a source throws unexpectedly, then its `SourceStatus` has `SourceUnexpected`, status 500 and the generic message (not the exception message), and the exception is logged at error level.
- **AC-17:** Given the store is unavailable, at the start or part-way through, then `SearchAsync` returns a `StoreUnavailable` failure.

**Function and UI**

- **AC-18:** Given `days=0` and 11 keywords, then the response is 400 with body `{ errors: [DaysOutOfRange, TooManyKeywords] }`, and no search runs.
- **AC-19:** Given the service returns a failure, then the response is 503 with body `{ errors: [...] }`.
- **AC-20:** Given every source failed, then the response is 502 with the full result.
- **AC-21:** Given one source failed with an upstream 401 and others succeeded, then the response is 200 (not 401), and that source's entry has `upstreamStatus: 401` and `errors`.
- **AC-22:** Error codes appear in JSON as names (e.g. `"code": "StoreUnavailable"`), and `upstreamStatus` appears as a number.
- **AC-23:** The UI shows a top-level error's messages from `errors`, and a failed source's chip shows its error messages as a tooltip.
- **AC-24:** No `catch` exists in `src/` apart from the four source adapters, `TableJobStore.WithStoreAsync` and the `JobSearchService` safety net.

## Deferred Decisions

None.

## Open Questions

None.
