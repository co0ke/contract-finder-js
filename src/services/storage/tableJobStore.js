import { RestError, TableClient } from '@azure/data-tables';
import { chunk, distinctBy, groupBy } from '../../common/collections.js';
import { createError } from '../../common/error.js';
import { ErrorCode, isErrorCode } from '../../common/errorCode.js';
import { HttpStatus } from '../../common/httpStatus.js';
import { Result } from '../../common/result.js';
import { TableStoreConstants } from '../../constants/tableStoreConstants.js';
import { createJob } from '../../models/job.js';
import { createSourceRun } from '../../models/jobSearch.js';

/**
 * @typedef {object} JobStoreOptions
 * @property {string} connectionString Defaults to Azurite, the local storage emulator.
 */

/** @param {Partial<JobStoreOptions>} [fields] @returns {JobStoreOptions} */
export const createJobStoreOptions = ({ connectionString = TableStoreConstants.DefaultConnectionString } = {}) =>
  Object.freeze({ connectionString });

// .NET ticks (100 ns) between 0001-01-01 and the Unix epoch, and DateTimeOffset.MaxValue.UtcTicks.
const EpochTicks = 621_355_968_000_000_000n;
const MaxTicks = 3_155_378_975_999_999_999n;

/**
 * Stores adverts and run history in Azure Table Storage (Azurite locally).
 * Adverts are keyed on source (partition) + the source's advert id (row); runs on source + inverted time, newest first.
 * @implements {import('./jobStore.js').IJobStore}
 */
export class TableJobStore {
  #jobs;
  #runs;
  #tablesExist = false;
  /** @type {Promise<void> | null} */
  #creating = null;

  /**
   * @param {ReturnType<typeof TableJobStore.createClients>} clients One client per table, from {@link TableJobStore.createClients}.
   */
  constructor({ jobs, runs }) {
    this.#jobs = jobs;
    this.#runs = runs;
  }

  /**
   * Clients that fail fast when the store isn't reachable, rather than retrying for most of a minute.
   * @param {string} connectionString
   * @param {{ maxRetries?: number, networkTimeoutMs?: number }} [options]
   */
  static createClients(connectionString, { maxRetries = TableStoreConstants.MaxRetries, networkTimeoutMs = TableStoreConstants.NetworkTimeoutMs } = {}) {
    const clientOptions = {
      retryOptions: { maxRetries },
      // Azurite and the unreachable-store test use plain http.
      allowInsecureConnection: true,
    };
    const withTimeout = (client) => ({
      client,
      /** Passed to every operation: the request timeout in ms. */
      operationOptions: { requestOptions: { timeout: networkTimeoutMs } },
    });
    return {
      jobs: withTimeout(TableClient.fromConnectionString(connectionString, TableStoreConstants.JobsTable, clientOptions)),
      runs: withTimeout(TableClient.fromConnectionString(connectionString, TableStoreConstants.RunsTable, clientOptions)),
    };
  }

  /**
   * @param {ReadonlyArray<import('../../models/job.js').Job>} jobs
   * @param {Date} seenAt
   */
  upsert(jobs, seenAt) {
    return this.#withStore(async () => {
      const distinct = distinctBy(jobs, (j) => `${j.source}\u0000${j.id}`);
      for (const [source, partition] of groupBy(distinct, (j) => j.source)) {
        // Keep each existing advert's first-seen time.
        const firstSeen = new Map();
        const existing = this.#list(this.#jobs, {
          filter: `PartitionKey eq ${quote(TableJobStore.escapeKey(source))}`,
          select: ['RowKey', 'FirstSeenAt'],
        });
        for await (const entity of existing) {
          if (entity.FirstSeenAt instanceof Date) {
            firstSeen.set(entity.rowKey, entity.FirstSeenAt);
          }
        }

        for (const batch of chunk(partition, TableStoreConstants.MaxBatchSize)) {
          const actions = batch.map((job) => [
            'upsert',
            TableJobStore.toEntity(job, firstSeen.get(TableJobStore.escapeKey(job.id)) ?? seenAt, seenAt),
            'Replace',
          ]);
          await this.#jobs.client.submitTransaction(actions, this.#jobs.operationOptions);
        }
      }
    });
  }

  /** @param {Date} since */
  query(since) {
    return this.#withStore(async () => {
      const jobs = [];
      for await (const entity of this.#list(this.#jobs, { filter: TableJobStore.sinceFilter(since) })) {
        jobs.push(TableJobStore.toJob(entity));
      }
      return jobs;
    });
  }

  /** @param {import('../../models/jobSearch.js').SourceRun} run */
  recordRun(run) {
    return this.#withStore(async () => {
      await this.#runs.client.upsertEntity(TableJobStore.toRunEntity(run), 'Replace', this.#runs.operationOptions);
    });
  }

  /** @param {string} source @param {number} count */
  getRecentRuns(source, count) {
    return this.#withStore(async () => {
      const runs = [];
      const entities = this.#list(this.#runs, { filter: `PartitionKey eq ${quote(TableJobStore.escapeKey(source))}` }, count);
      for await (const entity of entities) {
        runs.push(TableJobStore.toRun(source, entity));
        if (runs.length === count) {
          break;
        }
      }
      return runs;
    });
  }

  /** @param {Date} cutoff */
  deleteOlderThan(cutoff) {
    return this.#withStore(async () =>
      await this.#delete(this.#jobs, `Timestamp lt ${formatDateTime(cutoff)}`)
      + await this.#delete(this.#runs, `${TableStoreConstants.RunAtColumn} lt ${formatDateTime(cutoff)}`));
  }

  async #delete(table, filter) {
    const keys = [];
    for await (const entity of this.#list(table, { filter, select: ['PartitionKey', 'RowKey'] })) {
      keys.push({ partition: entity.partitionKey, row: entity.rowKey });
    }

    for (const [, partition] of groupBy(keys, (k) => k.partition)) {
      for (const batch of chunk(partition, TableStoreConstants.MaxBatchSize)) {
        await table.client.submitTransaction(batch.map((k) => ['delete', { partitionKey: k.partition, rowKey: k.row }]), table.operationOptions);
      }
    }
    return keys.length;
  }

  #list(table, queryOptions, maxPerPage) {
    const iterator = table.client.listEntities({ queryOptions, ...table.operationOptions });
    return maxPerPage === undefined ? iterator : flatten(iterator.byPage({ maxPageSize: maxPerPage }));
  }

  /** @param {import('../../models/jobSearch.js').SourceRun} run */
  static toRunEntity(run) {
    return {
      partitionKey: TableJobStore.escapeKey(run.source),
      rowKey: newestFirstKey(run.at),
      [TableStoreConstants.RunAtColumn]: run.at,
      Count: { value: run.count, type: 'Int32' },
      // Stored by name, so reordering ErrorCode's members doesn't change what old rows mean.
      [TableStoreConstants.RunErrorCodeColumn]: run.error?.code ?? null,
      Error: run.error?.message ?? null,
    };
  }

  /** @param {string} source @param {Record<string, any>} entity */
  static toRun(source, entity) {
    return createSourceRun(source, toDate(entity[TableStoreConstants.RunAtColumn]), toInt(entity.Count) ?? 0, toError(entity));
  }

  /**
   * Adverts posted, or when undated last seen, at or after `since`.
   * @param {Date} since
   */
  static sinceFilter(since) {
    return `${TableStoreConstants.PostedOrLastSeenAtColumn} ge ${formatDateTime(since)}`;
  }

  /**
   * Makes a value safe as a PartitionKey or RowKey, which can't contain / \ # ? or control characters.
   * "%" is escaped too, so distinct ids never share a key.
   * @param {string} value
   */
  static escapeKey(value) {
    return value.replace(/[/\\#?%\p{Cc}]/gu, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  }

  /**
   * @param {import('../../models/job.js').Job} job
   * @param {Date} firstSeenAt
   * @param {Date} lastSeenAt
   */
  static toEntity(job, firstSeenAt, lastSeenAt) {
    return {
      partitionKey: TableJobStore.escapeKey(job.source),
      rowKey: TableJobStore.escapeKey(job.id),
      Source: job.source,
      Id: job.id,
      Title: job.title,
      Company: job.company,
      Location: job.location,
      // Table Storage has no decimal type, and a double could change the figure.
      DayRateMin: job.dayRateMin === null ? null : String(job.dayRateMin),
      DayRateMax: job.dayRateMax === null ? null : String(job.dayRateMax),
      RateIsEstimated: job.rateIsEstimated,
      PostedAt: job.postedAt,
      Url: job.url,
      Snippet: job.snippet,
      FirstSeenAt: firstSeenAt,
      [TableStoreConstants.PostedOrLastSeenAtColumn]: job.postedAt ?? lastSeenAt,
    };
  }

  /** @param {Record<string, any>} entity */
  static toJob(entity) {
    return createJob({
      source: entity.Source,
      id: entity.Id,
      title: entity.Title,
      company: entity.Company ?? null,
      location: entity.Location ?? null,
      dayRateMin: parseDecimal(entity.DayRateMin),
      dayRateMax: parseDecimal(entity.DayRateMax),
      rateIsEstimated: entity.RateIsEstimated ?? false,
      postedAt: toDate(entity.PostedAt),
      url: entity.Url,
      snippet: entity.Snippet ?? null,
      firstSeenAt: toDate(entity.FirstSeenAt),
    });
  }

  /**
   * The one place the table SDK's errors for an unreachable store become a Result.
   * @template T
   * @param {() => Promise<T>} action
   * @returns {Promise<Result<T>>}
   */
  async #withStore(action) {
    try {
      await this.#ensureTables();
      return Result.success(await action());
    } catch (error) {
      // No status means no response at all (refused, DNS, timeout); anything the service answered is rethrown.
      if (isUnreachable(error)) {
        return Result.failure(HttpStatus.InternalServerError, createError(
          ErrorCode.StoreUnavailable,
          'Can\'t reach table storage. Locally, start Azurite (e.g. `azurite --location .azurite`).'));
      }
      throw error;
    }
  }

  // Not cached as a failed promise: if Azurite wasn't running, the next search should try again.
  async #ensureTables() {
    if (this.#tablesExist) {
      return;
    }
    if (this.#creating === null) {
      this.#creating = (async () => {
        await this.#jobs.client.createTable(this.#jobs.operationOptions);
        await this.#runs.client.createTable(this.#runs.operationOptions);
        this.#tablesExist = true;
      })().finally(() => { this.#creating = null; });
    }
    await this.#creating;
  }
}

const isUnreachable = (error) =>
  error instanceof RestError && (error.statusCode === undefined || error.statusCode === 0);

// Rows written before error codes were stored have only a message; they read as Unknown.
function toError(entity) {
  const message = entity.Error;
  if (typeof message !== 'string') {
    return null;
  }
  const code = entity[TableStoreConstants.RunErrorCodeColumn];
  return createError(typeof code === 'string' && isErrorCode(code) ? code : ErrorCode.Unknown, message);
}

const quote = (value) => `'${value.replaceAll("'", "''")}'`;

// OData datetime literal as Azure.Data.Tables writes it: no fraction when it's zero, otherwise trimmed.
function formatDateTime(date) {
  const iso = date.toISOString().replace(/\.?0+Z$/, 'Z').replace(/(\.\d*?)0+Z$/, '$1Z');
  return `datetime'${iso}'`;
}

// Rows in a partition come back in key order, so an inverted, fixed-width timestamp lists the newest first.
function newestFirstKey(at) {
  const ticks = BigInt(at.getTime()) * 10_000n + EpochTicks;
  return (MaxTicks - ticks).toString().padStart(19, '0');
}

const parseDecimal = (value) => (value === null || value === undefined ? null : Number(value));

function toDate(value) {
  if (value === null || value === undefined) {
    return null;
  }
  return value instanceof Date ? value : new Date(value);
}

function toInt(value) {
  if (value === null || value === undefined) {
    return null;
  }
  // The SDK returns typed properties as { value, type } when the type needs saying, e.g. Int32 written by this store.
  const raw = typeof value === 'object' ? value.value : value;
  return Number.parseInt(raw, 10);
}

async function* flatten(pages) {
  for await (const page of pages) {
    yield* page;
  }
}
