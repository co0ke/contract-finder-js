import { loadConfig } from './config.js';
import { ConfigConstants } from './constants/configConstants.js';
import { AdzunaConstants } from './constants/adzunaConstants.js';
import { EmagineConstants } from './constants/emagineConstants.js';
import { JobServeConstants } from './constants/jobServeConstants.js';
import { ReedConstants } from './constants/reedConstants.js';
import { TechJobsConstants } from './constants/techJobsConstants.js';
import { createAppHandler, createAppScriptHandler } from './functions/app.js';
import { createCleanUpJobsHandler } from './functions/cleanUpJobs.js';
import { createGetJobsHandler } from './functions/getJobs.js';
import { createMockFetch } from './mocks/mockFetch.js';
import { JobCleanupService } from './services/jobCleanupService.js';
import { JobSearchService } from './services/jobSearchService.js';
import { consoleLogger } from './services/logger.js';
import { AdzunaJobSource, createAdzunaOptions } from './services/sources/adzunaJobSource.js';
import { EmagineJobSource } from './services/sources/emagineJobSource.js';
import { HttpClient } from './services/sources/httpClient.js';
import { JobServeJobSource } from './services/sources/jobServeJobSource.js';
import { ReedJobSource, createReedOptions } from './services/sources/reedJobSource.js';
import { RetryPolicy } from './services/sources/retryPolicy.js';
import { TechJobsJobSource } from './services/sources/techJobsJobSource.js';
import { InMemoryJobStore } from './services/storage/inMemoryJobStore.js';
import { systemTime } from './services/time.js';

const MockCredential = 'mock';

/**
 * Wires the app together: the equivalent of Program.cs. With `mockExternals` (the default) the store is
 * in memory and the job sites are answered from canned data, so nothing leaves the process.
 *
 * @param {object} [overrides]
 * @param {NodeJS.ProcessEnv} [overrides.env]
 * @param {import('./services/time.js').TimeProvider} [overrides.time]
 * @param {import('./services/logger.js').Logger} [overrides.logger]
 * @param {typeof fetch} [overrides.fetchImpl] The transport for live job sites.
 * @param {import('./services/storage/jobStore.js').IJobStore} [overrides.store]
 * @param {RetryPolicy} [overrides.retryPolicy] How job-site requests are retried; tests pass one that doesn't wait.
 */
export async function createApp({ env = process.env, time = systemTime, logger = consoleLogger, fetchImpl, store, retryPolicy } = {}) {
  let config = loadConfig(env);

  if (config.mockExternals) {
    store ??= new InMemoryJobStore();
    fetchImpl ??= createMockFetch({ time, failingSources: config.mockFailingSources, flakySources: config.mockFlakySources });
    // The mock sites don't check credentials, but the sources refuse to search without them.
    config = Object.freeze({
      ...config,
      adzuna: createAdzunaOptions({ ...config.adzuna, appId: config.adzuna.appId || MockCredential, appKey: config.adzuna.appKey || MockCredential }),
      reed: createReedOptions({ apiKey: config.reed.apiKey || MockCredential }),
    });
  } else {
    fetchImpl ??= globalThis.fetch;
    if (!store) {
      // Loaded on demand so the mock mode never touches the Azure SDK.
      const { TableJobStore } = await import('./services/storage/tableJobStore.js');
      store = new TableJobStore(TableJobStore.createClients(config.jobStore.connectionString));
    }
  }

  const retry = retryPolicy ?? new RetryPolicy({ logger });
  const http = (baseAddress) => new HttpClient(baseAddress, fetchImpl, { retry });
  const sources = [
    new AdzunaJobSource(http(AdzunaConstants.BaseAddress), config.adzuna),
    new ReedJobSource(http(ReedConstants.BaseAddress), config.reed, time),
    new EmagineJobSource(http(EmagineConstants.BaseAddress)),
    new JobServeJobSource(http(JobServeConstants.BaseAddress), time),
    new TechJobsJobSource(http(TechJobsConstants.BaseAddress)),
  ];

  const search = new JobSearchService(sources, store, time, logger);
  const cleanup = new JobCleanupService(store, time);

  logger.info(config.mockExternals
    ? `Contract Finder: using the in-memory store and mock job sites (set ${ConfigConstants.MockExternalsSetting}=false for the real ones).`
    : 'Contract Finder: using Table Storage and the live job sites.');

  return Object.freeze({
    config,
    store,
    sources,
    services: { search, cleanup },
    handlers: {
      app: createAppHandler({ options: config.search }),
      appScript: createAppScriptHandler(),
      getJobs: createGetJobsHandler({ search, options: config.search }),
      cleanUpJobs: createCleanUpJobsHandler({ cleanup, logger }),
    },
  });
}

/** @type {Promise<Awaited<ReturnType<typeof createApp>>> | null} */
let instance = null;

/** The process-wide app, built once (the store, like the C# singleton, must outlive a request). */
export function getApp() {
  instance ??= createApp();
  return instance;
}
