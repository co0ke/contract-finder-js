export const TableStoreConstants = Object.freeze({
  JobsTable: 'Jobs',
  RunsTable: 'SourceRuns',

  /** Azurite, the local storage emulator. */
  DefaultConnectionString: 'UseDevelopmentStorage=true',

  // What query() filters on: undated adverts (emagine) stay listed while a source still returns them.
  PostedOrLastSeenAtColumn: 'PostedOrLastSeenAt',
  RunAtColumn: 'At',
  RunErrorCodeColumn: 'ErrorCode',

  // A table transaction takes at most 100 entities, all in one partition.
  MaxBatchSize: 100,

  // Fail fast when the store isn't reachable, rather than retrying for most of a minute.
  MaxRetries: 1,
  NetworkTimeoutMs: 10_000,
});
