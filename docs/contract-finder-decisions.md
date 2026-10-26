# Contract Finder: design decisions (grill-me session, 25 Sep 2026)

Handoff notes for Claude Code. This file records the decisions from a design review of the Contract Finder POC (`TemplateTest.sln`). Read it together with `CLAUDE.md`, which describes the code as it stands. Where the two differ, **this file is the target design**. Items under "Open questions" are **not decided**: ask the user about them rather than assuming.

## Goal

Make it easier to find relevant UK contract roles across multiple job sites, in one list sorted newest first.

## Decisions

### Running and storage
- **Runs locally, on demand** (`func start`, then use it). No hosting and no scheduler for now.
- **Storage: Azure Table Storage behind a new `IJobStore` interface**, using **Azurite** locally. SQLite was rejected because it doesn't survive deployment to Functions (temporary disk on Consumption/Flex; unreliable locking over the Azure Files network share on Premium/Dedicated).
  - Suggested keys: PartitionKey = source, RowKey = source advert id.
  - Store each advert once, with a `FirstSeenAt` timestamp, so the UI can show **"new since last run"**.
  - Also store a **run history**: one row per source per run, with the count and any error. Use it to flag a likely broken source (e.g. "JobServe returned 0, usual is ~30"), because a changed HTML layout currently returns 0 jobs with no error.
- Suggested interface shape (not final):
  ```csharp
  public interface IJobStore
  {
      Task<IReadOnlyList<Job>> UpsertAsync(IEnumerable<Job> jobs, CancellationToken ct); // returns only new jobs
      Task RecordRunAsync(SourceStatus status, CancellationToken ct);
      Task<IReadOnlyList<Job>> QueryAsync(JobFilter filter, CancellationToken ct);
  }
  ```

### Sources
- **Adzuna, Reed, emagine, JobServe** (already implemented). Do **not** add LinkedIn: it forbids scraping in its terms.
- Search **broadly** rather than with one title keyword, e.g. ".NET", "C#", "Azure", "backend engineer", "software engineer". Our own rules below then decide what's relevant.

### Relevance rules (what gets into the list)
1. **Always in:** the advert mentions **.NET, C# or Azure**. No extra fetch and no LLM call are needed.
2. **Generic roles** (backend/software engineer) that **name no stack**: in (assumption; the user didn't object).
3. **Roles on another stack** (Java, Go, Python, etc.): in **only if the advert explicitly says it will consider people from other backgrounds**. This is decided by an **LLM yes/no check**:
   - Run it only on **new** adverts that fail rule 1.
   - Use a small, cheap model. Prompt, roughly: *"Does this advert explicitly say it will consider candidates from other languages or stacks, such that a senior C#/.NET engineer would qualify? Answer yes/no and quote the sentence."*
   - Store the verdict and the quoted sentence with the advert. Show the quote in the UI.
   - **Keep rejected adverts too**, each with the model's one-line reason, so the user can spot-check for missed roles for the first few weeks.
4. **IR35:** inside and outside are both acceptable.
5. **Rate:** no floor. (A soft cut-off of ~£350/day, applied only when a rate is stated, was suggested to remove mis-tagged junior roles. It's **not confirmed**.)
6. **Location:** **anything in the UK.** No remote/hybrid filtering for now. The user's eventual rules, parked for later:
   - remote: always in
   - hybrid in London or Bristol: up to 3 days a week
   - hybrid anywhere else in the UK: up to 2–3 days a month

### Full advert text
- Fetch the full description **only for adverts needing a judgement call** (generic or other-stack), and only once per advert. Store it.
  - **Reed:** official details endpoint (`/jobs/{id}`).
  - **JobServe:** fetch the advert page, **throttled** (~1 request every 2–3 s, with a cap per run), because it blocks clients that make too many requests (200 with an empty body).
  - **Adzuna:** no full-text API; use the snippet.
  - **emagine:** check whether the search response already includes the description.

### Ordering
- **Newest first.** No scoring or ranking. (Travel-cost-adjusted "effective rate" ranking was considered and rejected.)

## Issues found in the current code

1. **Bug: duplicate removal loses data.** `JobSearchService.DuplicateKey` is normalised title + company. emagine adverts (and any others with no company) have an empty company, so **different roles with the same title collapse into one**. Fix: when the company is missing, don't merge; fall back to source + id.
2. **Matching is title-only.** Adzuna uses `title_only` and Reed filters on the title. As a result, roles that mention Azure/C# only in the description, and other-stack roles open to .NET engineers, can never appear. The broad-search + rules design above replaces this.
3. **Location** is a single substring match. Under the current decision it's replaced by UK-wide.
4. **A broken source can look like a quiet day.** A changed layout gives 0 results with no error. The run history above addresses this.
5. **JobServe stops at `MaxPages` = 3**, so on busy weeks older matches are silently dropped. (Not yet decided; see open questions.)

## Open questions (ask the user; each has a recommendation)

- **Cross-agency duplicates** (the same role posted by several agencies). *Recommendation:* fix bug 1 now. Later, group (don't merge) adverts with the same normalised title posted within 3 days, shown as "+N similar". *The user hadn't answered when the session ended.*
- **AI/agentic roles that aren't .NET** (e.g. Python agent roles), given the user's pivot to agentic AI. In scope or not? *Unanswered.*
- **~£350/day soft cut-off** for stated rates: yes/no? *Unanswered.*
- **JobServe page cap:** raise it, or rely on repeated local runs plus storage to fill gaps? *Not yet discussed.*
- **LLM provider/model** for the openness check (e.g. Claude Haiku via the Anthropic API, or a model via Azure AI Foundry): *not yet discussed.* Keep it behind an interface.
- **How the user judges whether it's working.** *Suggested:* (a) roles they'd have applied to that it missed, and (b) roles shown that they rejected within seconds. *Not confirmed.*

## Suggested build order

1. Fix the duplicate bug (company missing → no merge), with tests.
2. Add `IJobStore` with Table Storage + Azurite; upsert adverts, `FirstSeenAt`, and "new since last run" in the API/UI.
3. Run history + a "source looks broken" warning.
4. Broad multi-keyword search per source, plus the rule 1 (.NET/C#/Azure) filter over title + snippet.
5. Full-text fetch for judgement-call adverts (Reed details API; throttled JobServe).
6. LLM openness check behind an interface; store the verdict + quote; show the quote in the UI; "rejected" view.
7. Later: location tags/rules, cross-agency grouping.

Follow the existing conventions in `CLAUDE.md`: one class per source behind `IJobSource`, test naming `MethodName_SituationTested_ExpectedOutcome`, no real HTTP in tests (`StubHttpHandler`, `FixedTimeProvider`), and time logic that passes under a non-UTC `TZ`.
