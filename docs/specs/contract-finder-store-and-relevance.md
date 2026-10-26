# Spec: stored adverts, source health and relevance rules

Status: ready-for-agent
Source: `docs/contract-finder-decisions.md` (design review, 25 Sep 2026), which covers build steps 2–6. Step 1, the fix for merged adverts with no company, is already done.

## Problem Statement

I'm a senior C#/.NET contractor looking for UK contract roles. Contract Finder already merges four job sites into one list sorted newest first, but it has several problems:

- **It forgets everything between runs.** Each time I open it I see the whole list again, with no way to tell which adverts are new since I last looked.
- **A broken source looks like a quiet day.** If JobServe changes its HTML layout, it returns 0 jobs and no error. I can't tell "nothing new" apart from "this source is broken".
- **Matching is on the title only.** Adzuna searches titles only and Reed filters on the title. Roles that mention C# or Azure only in the description never appear. Neither do roles on another stack whose adverts say they'll consider people from other backgrounds, even though I'd qualify.
- **The search is too narrow.** It uses one keyword (".NET") and one location substring. Generic "backend engineer" or "software engineer" contracts that name no stack are missed.

## Solution

Each time I run Contract Finder locally, it will:

1. Search every source broadly, using several keywords across the whole UK.
2. Store every advert it sees in Azure Table Storage (Azurite when running locally), so it knows when it first saw each one.
3. Decide which adverts are relevant using fixed rules:
   - An advert that mentions .NET, C# or Azure is always in.
   - A generic role that names no stack is in.
   - A role on another stack is in only if the advert explicitly says it will consider people from other backgrounds. A cheap LLM makes this yes/no check once per advert and quotes the sentence it relied on.
4. Show one list, newest first, with adverts new since the last run marked. Where the LLM let an advert in, its quoted sentence is shown alongside.
5. Warn me when a source returns far fewer adverts than usual.
6. Keep the adverts the LLM rejected, each with the model's one-line reason, in a separate view. That lets me spot-check for missed roles.

## User Stories

1. As a contractor, I want each run to search every source with several keywords (".NET", "C#", "Azure", "backend engineer", "software engineer"), so that relevant roles aren't missed because the title uses different wording.
2. As a contractor, I want the search to cover the whole UK without choosing a location, so that I don't miss roles in cities I didn't think to type.
3. As a contractor, I want the keyword list to live in configuration, so that I can tune it without changing code.
4. As a contractor, I want an advert that mentions .NET, C# or Azure anywhere in its title or text to always be in the list, so that clearly relevant roles are never filtered out.
5. As a contractor, I want rule 1 to be decided from the title and snippet without an extra fetch or LLM call, so that the common case is fast and free.
6. As a contractor, I want generic backend or software engineer roles that name no stack to be in the list, so that stack-agnostic roles I could do aren't hidden.
7. As a contractor, I want roles on another stack (Java, Go, Python, etc.) to be in only when the advert explicitly says it will consider people from other languages or stacks, so that the list isn't flooded with roles I won't get.
8. As a contractor, I want that decision made by a small, cheap LLM, so that it reads the advert's wording rather than relying on brittle keyword matches.
9. As a contractor, I want the LLM check to run only on new adverts that fail rule 1, so that cost and latency stay low and no advert is checked twice.
10. As a contractor, I want the sentence the LLM relied on to be shown in the list next to the advert it let in, so that I can see at a glance why an other-stack role is there.
11. As a contractor, I want adverts the LLM rejected to be kept, each with the model's one-line reason, so that I can spot-check for missed roles during the first few weeks.
12. As a contractor, I want a separate "rejected" view in the UI, so that rejected adverts don't clutter the main list but I can still review them.
13. As a contractor, I want the full advert text fetched only for adverts that need a judgement call, and only once per advert, so that the tool stays quick and polite to the job sites.
14. As a contractor, I want Reed's full text to come from its official details endpoint, so that the judgement uses the whole advert and not just the search snippet.
15. As a contractor, I want JobServe advert pages fetched slowly (about one every 2–3 seconds) with a cap per run, so that JobServe doesn't block me.
16. As a contractor, I want Adzuna adverts judged from their snippet, since Adzuna has no full-text API, so that they still take part in the rules.
17. As a contractor, I want emagine adverts to use the description from the search response if it contains one, so that no extra request is needed.
18. As a contractor, I want an advert whose full text reveals .NET, C# or Azure to be accepted under rule 1 without an LLM call, so that the snippet's brevity doesn't cost an unnecessary check.
19. As a contractor, I want every advert stored once per source, keyed on the source's own advert id, so that repeated runs don't create duplicates.
20. As a contractor, I want each stored advert to record when it was first seen, so that the UI can mark it as new.
21. As a contractor, I want adverts first seen in this run marked "new" in the UI, so that I can go straight to what's changed since I last looked.
22. As a contractor, I want the list to include matching adverts stored by earlier runs within the chosen age window, so that an advert a source failed to return this time (e.g. beyond JobServe's page cap) doesn't disappear.
23. As a contractor, I want the stored full text, verdict, quote and reason kept with the advert, so that the judgement is never repeated and survives restarts.
24. As a contractor, I want each run to record one history row per source, with its count and any error, so that I can see how each source normally behaves.
25. As a contractor, I want a warning when a source returns far fewer adverts than it usually does (e.g. "JobServe returned 0, usual is ~30"), so that a changed layout isn't mistaken for a quiet day.
26. As a contractor, I want the warning shown on that source's chip in the UI, next to the existing "unavailable" state, so that source health appears in one place.
27. As a contractor, I want no warning while there isn't enough history to know what normal looks like, so that the first few runs don't cry wolf.
28. As a contractor, I want a source that fails outright to still be reported as an error, not a warning, and not to stop the other sources, so that today's behaviour is kept.
29. As a contractor, I want the API to keep returning 502 only when every source failed, so that partial results are still useful.
30. As a contractor, I want the list sorted newest first with undated adverts last, and no scoring or ranking, so that the order stays predictable.
31. As a contractor, I want the same role from two sources with the same company still merged into one entry, keeping the advert with a stated rate and then the newest, so that duplicates don't return now that adverts are stored.
32. As a contractor, I want adverts with no company never merged with each other, so that different emagine roles with the same title all appear.
33. As a contractor, I want inside- and outside-IR35 roles both kept, so that the list isn't narrowed by IR35 status.
34. As a contractor, I want no minimum day rate applied, so that roles with no rate or a low one aren't dropped silently.
35. As a contractor, I want an advert whose LLM check failed (e.g. a timeout) to show in the main list marked as unchecked, and to be retried next run, so that a transient failure never hides a role.
36. As a contractor, I want a clear error telling me to start Azurite when storage can't be reached, so that I know why the page is empty.
37. As a contractor, I want the storage connection string to default to Azurite locally and be configurable, so that the same code works if it's hosted later.
38. As a contractor, I want the LLM provider hidden behind an interface and configured by settings, so that I can switch between the Anthropic API and Azure AI Foundry without touching the rules.
39. As a developer, I want adding a new source to stay a new class plus two registration lines, so that the store, rules and function don't need to know about specific sites.
40. As a developer, I want the whole run testable through the search service with in-memory fakes, and no Azurite, network or LLM calls, so that the test suite stays fast and deterministic.

## Implementation Decisions

### Modules

- **Search query**: the query changes from a single keyword string plus a location to a list of keywords plus a maximum age. The location is dropped, because every source searches the whole UK. The keyword list comes from configuration, with a default list. The function's `q` and `location` parameters no longer drive the search. `days` stays as it is (1–60, default 7) and filters stored adverts by posted date.
- **Job sources (`IJobSource`)**: each source receives the keyword list and decides how to use it. Some make one request with OR syntax (Adzuna); others make one request per keyword and de-duplicate by their own advert id. The title-only matching is removed: Adzuna's title-only parameter and Reed's client-side title filter both go, and the rules below decide relevance. Filtering to the UK stays in the sources that already do it (emagine, JobServe). JobServe's page cap and blocking behaviour are unchanged. Each source makes its searches within the existing limits, so JobServe still only fetches its capped number of pages in total.
- **Full-text fetch**: a new optional capability, a separate interface, that a source implements when it can fetch an advert's full description by id. The service asks for full text only for adverts that fail rule 1 on title and snippet, only when no stored description exists, and only for sources that implement the capability. There are four cases:
  - Reed calls its official details endpoint.
  - JobServe fetches the advert page, spaced about 2–3 seconds apart using the injected `TimeProvider`, and stops after a configurable cap per run. Adverts beyond the cap stay pending until the next run.
  - emagine: first check whether the search response already carries a description. If it does, map it into the snippet and don't implement the capability.
  - Adzuna doesn't implement it and is judged on its snippet.
- **Relevance rules**: a new pure module with no I/O that classifies an advert's text (title, snippet and full text when known) into one of three outcomes:
  - *stack match*: mentions .NET, C# or Azure, so it's in.
  - *generic*: names no stack from a configured list of other stacks, so it's in.
  - *other stack*: needs the openness check.
  
  Matching must treat ".NET", "dotnet", "C#" and "Azure" as whole terms: "C#" must not match inside unrelated words, and ".NET" must not match "network".
- **Openness check**: a new interface. Given an advert's text, it returns whether the advert explicitly says it will consider candidates from other languages or stacks such that a senior C#/.NET engineer would qualify. It also returns the quoted sentence (when yes) and a one-line reason (always). The first adapter calls a small, cheap model. The provider is chosen in configuration and isn't decided yet (see Further Notes). The adapter parses a structured yes/no response. A malformed response or a transport failure counts as "unchecked", not "rejected".
- **Job store (`IJobStore`)**: a new interface. Roughly:
  - *upsert adverts*: returns only the adverts not seen before. For an existing advert it refreshes the searchable fields but keeps its first-seen time, full text and verdict.
  - *save judgement*: stores the full text and the verdict with its quote and reason.
  - *record a source run*: stores one row per source per run.
  - *read recent runs for a source*: used for the broken-source warning.
  - *query adverts*: takes a filter of maximum age and view (accepted or rejected).
- **Table Storage adapter**: implements the store with Azure Table Storage (Azure.Data.Tables):
  - **Adverts table**: PartitionKey = source name, RowKey = the source's advert id, escaped for characters Table Storage rejects in keys.
  - **Runs table**: PartitionKey = source name, RowKey = inverted run timestamp, so the newest runs read first.
  - The connection string comes from configuration and defaults to Azurite's development storage. Tables are created if missing.
- **Job model**: the normalised advert gains:
  - first-seen time
  - a "new" flag (first seen in this run)
  - a relevance outcome: stack match, generic, open to other stacks, rejected or unchecked
  - the quoted sentence and the reason
  
  Full text is stored but not returned by the list API.
- **Source status**: gains an optional warning alongside the existing count and error.
- **Broken-source warning**: after a source returns, its count is compared with the median count of its last 10 successful runs. A warning is raised when that median is at least 5 and this run returned less than a quarter of it (so a 0 always warns once a normal level is established). With fewer than 3 prior successful runs there's no warning. The thresholds are named constants that are easy to tune.
- **Search service (`JobSearchService`)**: orchestrates one run:
  1. Query every source in parallel (unchanged failure isolation; only caller cancellation propagates).
  2. Record a run row per source and work out warnings.
  3. Upsert all adverts and get back the new ones.
  4. For new adverts and ones still unchecked, apply rule 1, then fetch full text if needed, re-apply the rules, run the openness check for other-stack adverts, and save the judgement.
  5. Query the store for the requested view and age window.
  6. De-duplicate with the existing rules (title + company, never merging adverts with no company), then sort newest first with undated adverts last.
- **Function (`GetJobs`)**:
  - Accepts `days` and a `view` of `accepted` (default) or `rejected`.
  - Returns sources (count, error, warning) and jobs.
  - Still returns 502 only when every source failed.
  - Returns 503 with a message to start Azurite when the store can't be reached.
- **UI**:
  - Marks new adverts.
  - Shows the LLM's quote under adverts it accepted as open to other stacks.
  - Shows an "unchecked" tag where relevant.
  - Shows warnings on source chips.
  - Adds a toggle for the rejected view that shows each reason.
  - Drops the keyword and location inputs.

### Registration

`Program.cs` registers the store adapter, the openness-check adapter, the relevance rules and each source's optional full-text capability. `JobSearchService` and `GetJobs` still don't know about specific sites.

## Testing Decisions

- **What makes a good test here**: tests exercise behaviour through the highest seam and assert on what a caller sees: returned adverts, source statuses and stored state read back through the store interface. They don't assert on the order of internal calls or on private helpers. Mapping tests compare whole records. Test names follow `MethodName_SituationTested_ExpectedOutcome`.
- **Primary seam: `JobSearchService.SearchAsync`.** It's driven by `FakeJobSource` plus new in-memory test doubles in the shared test-doubles file: an in-memory job store, a fake openness check with scripted verdicts, and a fake full-text capability. This seam covers:
  - new-since-last-run and first-seen time kept across runs
  - adverts from earlier runs still listed within the age window
  - run history and each warning threshold, including too little history
  - rule 1 without a fetch or LLM call
  - generic roles let in
  - other-stack roles accepted with a quote, or rejected with a reason
  - the openness check run only once per advert
  - unchecked adverts shown and retried
  - the full-text fetch skipped when text is already stored
  - the rejected view
  - de-duplication and sorting still correct over stored adverts
  - the existing failure-isolation and cancellation behaviour
- **Relevance rules**: covered mainly through the service. Direct table-style tests of the pure classifier are allowed for the tricky term matching ("C#", ".NET" vs "network", "dotnet", "Azure"), in the same style as the existing rate-parsing tests.
- **Sources (existing seam)**: each source is tested with `StubHttpHandler` and sample JSON or HTML trimmed from real responses. The tests cover:
  - the keyword list turned into requests
  - title-only filtering removed
  - the Reed details endpoint mapped to full text
  - JobServe advert pages parsed to full text, with spacing and the per-run cap tested under `FixedTimeProvider` without real waits
  - an emagine description mapped, if the response has one
- **Function (existing seam)**: `GetJobs` tests cover `days` and `view` validation, the response shape including warnings, 502 when every source fails, and 503 when the store is unavailable.
- **Adapters (thin tests only)**: the openness-check adapter is tested with `StubHttpHandler` for request shape, yes and no parsing, and malformed or failed responses becoming unchecked. The Table Storage adapter gets unit tests only for key escaping and entity mapping; there are no Azurite integration tests.
- **Time**: first-seen times, the age window and run ordering all use the injected `TimeProvider` and `DateTimeOffset`. The suite must pass under a non-UTC `TZ` (e.g. `TZ=America/New_York`).
- **Prior art**: the existing search-service, source and function tests (`JobSearchServiceTests`, the `*JobSourceTests` classes, `GetJobsTests`), plus `DayRateTests` and `JobServeRateTests` for table-style tests.

## Out of Scope

- Hosting, deployment and any scheduler: it runs locally on demand.
- LinkedIn as a source: its terms forbid scraping.
- Remote and hybrid location rules and location tags. The parked rules are: remote always in; hybrid in London or Bristol up to 3 days a week; hybrid elsewhere in the UK up to 2–3 days a month.
- Grouping cross-agency duplicates ("+N similar").
- A soft minimum day rate (~£350/day).
- Scoring or ranking, including travel-adjusted effective rate.
- Deciding whether AI/agentic roles that aren't .NET (e.g. Python agent roles) are in scope.
- Changing JobServe's page cap. This spec relies on stored adverts from earlier runs to fill gaps.
- Integration tests against a running Azurite.

## Further Notes

- **Open questions to settle before building:**
  - **LLM provider and model** for the openness check (e.g. Claude Haiku via the Anthropic API, or a model in Azure AI Foundry). The interface and "unchecked" handling don't depend on this, so steps 2–5 can go ahead first.
  - **How to judge whether it's working.** Suggested: roles I'd have applied to that it missed, and roles shown that I rejected within seconds.
- **Choices this spec makes that the design review didn't decide explicitly**, so check them:
  - Unchecked adverts are shown rather than hidden.
  - The list includes adverts stored by earlier runs.
  - The broken-source thresholds: median of the last 10 runs, at least 5, below a quarter.
  - `q` and `location` stop driving the search.
- **Suggested delivery slices**, each shippable on its own, following the design review's build order:
  1. Store with first-seen time and "new" in the API and UI.
  2. Run history and the warning.
  3. Broad keyword search and rule 1.
  4. Full-text fetch.
  5. Openness check and the rejected view.
- **JobServe's terms** allow downloading for personal use only. The throttled advert-page fetch keeps within that and within its blocking behaviour.
