# Contract Finder (Node.js)

Finds relevant UK contract roles across Adzuna, Reed, emagine, JobServe and TechJobs, and lists them once,
newest first, flagging adverts first seen by the current search.

A port of the C# / .NET `TemplateTest` solution. Layout, behaviour, JSON contract, error codes and tests are
carried over one-for-one; [docs/porting-notes.md](docs/porting-notes.md) lists the mappings.

**External dependencies are mocked by default**: an in-memory store and canned job-site responses, so it runs
and tests with no network, no Azure and no API keys.

## Run

Node.js 22+.

```bash
npm install
npm start                                   # http://localhost:7071/api/app
curl "http://localhost:7071/api/jobs?q=Blazor,%20F%23&days=3"
MOCK_FAILING_SOURCES="Reed,JobServe" npm start    # see how the UI shows broken sites
```

Real job sites and Table Storage (Azurite locally):

```bash
MOCK_EXTERNALS=false Adzuna__AppId=… Adzuna__AppKey=… Reed__ApiKey=… npm start
```

Under the Azure Functions host: `cp local.settings.example.json local.settings.json && func start`.
Functions: `App` (`GET /api/app`, anonymous), `AppScript` (`GET /api/app.js`, anonymous), `GetJobs`
(`GET /api/jobs`, function key), `CleanUpJobs` (timer, 03:30 UTC daily; `npm run cleanup` runs it once).

### Settings

Environment variables, named as in the .NET configuration.

| Setting | Default |
| --- | --- |
| `MOCK_EXTERNALS` | `true` — `false` uses Table Storage and the live sites |
| `JobStore__ConnectionString` | `UseDevelopmentStorage=true` |
| `Adzuna__AppId` / `Adzuna__AppKey` / `Adzuna__Country` | empty / empty / `gb` |
| `Reed__ApiKey` | empty |
| `Search__Keywords__0…N` (or comma-separated `Search__Keywords`) | `.NET, C#, Azure, backend engineer, software engineer` |
| `MOCK_FAILING_SOURCES` | none — sources that fail outright (mock mode only) |
| `MOCK_FLAKY_SOURCES` | none — sources that 503 twice per request, then answer; shows retries succeeding (mock mode only) |
| `PORT`, `RUN_CLEANUP_SCHEDULE` | `7071`, `true` (`npm start` only) |

## Retries

A job-site request that gets no response, times out, or returns 408/429/5xx is retried up to twice with
exponential backoff and jitter (≈0.5 s, then ≈1 s; capped at 8 s), or after the site's `Retry-After` when it
sends one (up to 30 s, beyond which the failure is reported). 4xx errors, caller cancellation and JobServe's
"blocked" page are never retried. Each retry is logged as a warning without the query string. Limits live in
`src/constants/retryConstants.js`; the policy is attached to the `HttpClient`s in `createApp()`, so unit-tested
sources make single attempts.

```bash
MOCK_FLAKY_SOURCES=Reed npm start        # every search: two 503s from Reed, retried, then a normal result
MOCK_FAILING_SOURCES=TechJobs npm start  # 503 every time: retries run out and the source is reported as failed
```

## API

`GET /api/jobs?q=<comma-separated keywords, ≤10, ≤50 chars each>&days=<1–60, default 7>`

| Status | Body |
| --- | --- |
| 200 | `{ keywords, sources: [{ name, count, warning, upstreamStatus, errors }], jobs, count }` |
| 502 | Same body; every source failed |
| 400 | `{ errors: [{ code, message }] }` — invalid input, every broken rule reported |
| 503 | `{ errors: [{ code: "StoreUnavailable", … }] }` |

## Tests

```bash
npm test              # node:test, no network
npm run test:tz       # same suite under TZ=America/New_York
```

The C# suite ported test-for-test (same names), plus tests for what's new in the port. The search page's own
scripts run under jsdom in `test/functions/page.test.js`. The Azurite integration tests in `test/integration/`
run only with `RUN_AZURITE_TESTS=true`.

## Layout

```
src/common        Result, AppError, ErrorCode
src/constants     one module per C# constants class
src/models        Job, JobSearchQuery, SourceStatus, SourceRun, JobCollection, JobSearchResult
src/functions     handlers + index.js (Azure Functions registrations)
src/services      JobSearchService, JobCleanupService, RelevanceRules, SourceHealth
  sources/        one class per job site (IJobSource), HttpClient, DayRate, JobServeRate
  storage/        IJobStore: InMemoryJobStore (mock), TableJobStore (Azure)
src/mocks         canned responses and the mock fetch
src/composition.js  Program.cs equivalent; chooses mock or live
src/server.js     plain node:http server for local use
src/wwwroot       index.html (no inline script) and app.js, served by App and AppScript
test/             mirrors src/; testDoubles.js ports TestDoubles.cs
```

## Swapping the mocks

Both seams are the ones the C# code had: `IJobStore` (`InMemoryJobStore` vs `TableJobStore`) and an
injectable `fetch` behind `HttpClient` (`createMockFetch()` vs the global). `createApp()` picks from
`MOCK_EXTERNALS` and also accepts `store`, `fetchImpl`, `time` and `logger` directly.
