# Porting notes: C# / .NET → Node.js

How the .NET solution maps onto this codebase. The other files here are the original design notes and still
describe the intended behaviour.

## Hosting

| .NET | Node |
| --- | --- |
| Functions isolated worker, `[Function]` attributes | Functions Node v4 model, `app.http` / `app.timer` in `src/functions/index.js` |
| `Program.cs` DI | `createApp()` in `src/composition.js`; settings from env via `src/config.js` |
| `req.Query["days"]`, `IActionResult` | `request.query` (`URLSearchParams`), `{ status, jsonBody }` / `{ status, body, headers }` |
| `func start` | `func start` or `npm start` (`node:http` server; cleanup scheduled in-process) |

Handlers are host-agnostic factories, so tests call them with a bare `{ query }`.

## Types

| .NET | Node |
| --- | --- |
| `Result` / `Result<T>` | one `Result` class; no implicit conversion, always `Result.success(x)` |
| `record Error` | `createError(code, message)` → frozen `{ code, message }` (named `AppError`) |
| enums serialised by name | frozen string maps |
| `record Job`, `with { }` | `createJob({ })` frozen object, `{ ...job, isNew: true }` |
| `[JsonIgnore] Failed` | prototype getter (not serialised); `JobSearchResult.count` via `toJSON` |
| `DateTimeOffset` | `Date`, always built from UTC components |
| `decimal`, `Math.Round` | `number`, `roundHalfToEven` (banker's rounding) |
| `TimeProvider`, `ILogger` | `{ now() }`, `{ info, warn, error }` |
| interfaces | JSDoc `@typedef` + `@implements` |

## HTTP failures

`HttpClient` becomes a small class over an injectable `fetch` with a 100 s timeout. Each source still catches
at the request, mapping fetch's errors as the C# mapped HttpClient's:

| fetch error | Result |
| --- | --- |
| `TypeError: fetch failed` | `SourceUnreachable` 500 |
| `TimeoutError` (`AbortSignal.timeout`) | `SourceTimeout` 500 |
| anything else (abort, bad JSON) | rethrown → `SourceUnexpected` in the service |

`reasonPhrase()` fills in the status text fetch leaves empty; `escapeDataString` matches `Uri.EscapeDataString`.

## Sources and storage

* JobServe: AngleSharp → cheerio; leading BOM stripped; UK local times via `Intl` (`localTime.js`).
* TechJobs string salaries and Adzuna's string/number/boolean `salary_is_predicted` handled as before.
* `TableJobStore` on `@azure/data-tables` writes the same keys, entities and filters as the C# store (inverted
  ticks via `BigInt`, `Count` typed `Int32`), so both can share a table. A `RestError` with no `statusCode`
  (≈ `RequestFailedException { Status: 0 }`) becomes `StoreUnavailable`.
* `InMemoryJobStore` (the C# test double) is now in `src/` and is the store in mock mode.

## Tests

| xUnit / Moq | node:test |
| --- | --- |
| `[Theory]` + `[InlineData]` | `for (const … of cases) it(…)` |
| `Assert.Equal` on records, `Assert.Single` | `assert.deepEqual`, `single()` |
| `Mock<IJobSearchService>` | `mock.fn()` |
| `StubHttpHandler`, `ThrowingHttpHandler`, `FixedTimeProvider` | `stubFetch`, `throwingFetch`, `fixedTime` |

Added beyond the C# suite: config, composition, scheduler, in-memory store, `localTime`, script-safe keyword
injection, and opt-in Azurite integration tests.

## Deliberate differences

* Mocks are the default (`MOCK_EXTERNALS=true`); Terraform sets `false` for the deployed app.
* **Retries** (new): `RetryPolicy` on each `HttpClient`, attached in `createApp()` — the place a .NET
  resilience handler would go. Exponential backoff with jitter, `Retry-After` honoured, only for failures that
  may recover. Sources and their tests are unchanged.
* Comma-separated `Search__Keywords` accepted alongside the indexed form.
* Request timeout is an explicit constant rather than HttpClient's implicit default.
* **No inline script.** The page's JavaScript is `wwwroot/app.js`, served by a second anonymous function
  (`AppScript`, `/api/app.js`) and loaded synchronously from `<head>` so the theme applies before first paint.
  The default keywords are injected as an HTML-escaped `data-default-keywords` attribute on `<html>` rather
  than spliced into a script literal, so a `script-src 'self'` CSP would hold.
