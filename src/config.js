import { ConfigConstants } from './constants/configConstants.js';
import { createSearchOptions } from './functions/searchOptions.js';
import { createAdzunaOptions } from './services/sources/adzunaJobSource.js';
import { createReedOptions } from './services/sources/reedJobSource.js';
import { createJobStoreOptions } from './services/storage/tableJobStore.js';

/**
 * Reads the same settings the .NET app bound from configuration, as environment variables (which is what
 * Azure app settings and local.settings.json become): `Section__Key`, and `Section__List__N` for arrays.
 * @param {NodeJS.ProcessEnv} [env]
 */
export function loadConfig(env = process.env) {
  const setting = (section, key) => env[`${section}__${key}`];
  const list = (section, key) => {
    const items = [];
    for (let i = 0; setting(section, `${key}__${i}`) !== undefined; i++) {
      items.push(setting(section, `${key}__${i}`));
    }
    // Also accept one comma-separated value, which is easier to type in a shell.
    if (items.length === 0 && setting(section, key) !== undefined) {
      return setting(section, key).split(',');
    }
    return items;
  };

  const names = (value) => (value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  const keywords = list(ConfigConstants.SearchSection, 'Keywords');
  return Object.freeze({
    mockExternals: (env[ConfigConstants.MockExternalsSetting] ?? 'true').toLowerCase() !== 'false',
    search: createSearchOptions({ keywords: keywords.length > 0 ? keywords : null }),
    jobStore: createJobStoreOptions({ connectionString: setting(ConfigConstants.JobStoreSection, 'ConnectionString') }),
    adzuna: createAdzunaOptions({
      appId: setting(ConfigConstants.AdzunaSection, 'AppId'),
      appKey: setting(ConfigConstants.AdzunaSection, 'AppKey'),
      country: setting(ConfigConstants.AdzunaSection, 'Country'),
    }),
    reed: createReedOptions({ apiKey: setting(ConfigConstants.ReedSection, 'ApiKey') }),
    /** Comma-separated source names the mock should fail, to try the UI's error handling. */
    mockFailingSources: names(env.MOCK_FAILING_SOURCES),
    /** Comma-separated source names the mock should fail transiently: two 503s per request, then success. */
    mockFlakySources: names(env.MOCK_FLAKY_SOURCES),
  });
}

