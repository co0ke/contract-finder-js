import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('LoadConfig_EmptyEnvironment_UsesDefaults', () => {
    const config = loadConfig({});

    assert.equal(config.mockExternals, true);
    assert.equal(config.search.keywords, null);
    assert.equal(config.jobStore.connectionString, 'UseDevelopmentStorage=true');
    assert.deepEqual(config.adzuna, { appId: '', appKey: '', country: 'gb' });
    assert.deepEqual(config.reed, { apiKey: '' });
    assert.deepEqual(config.mockFailingSources, []);
  });

  it('LoadConfig_SectionSettings_BindsLikeDotNetConfiguration', () => {
    const config = loadConfig({
      MOCK_EXTERNALS: 'False',
      JobStore__ConnectionString: 'conn',
      Adzuna__AppId: 'id', Adzuna__AppKey: 'key', Adzuna__Country: 'us',
      Reed__ApiKey: 'reed',
      Search__Keywords__0: '.NET', Search__Keywords__1: 'Azure',
    });

    assert.equal(config.mockExternals, false);
    assert.equal(config.jobStore.connectionString, 'conn');
    assert.deepEqual(config.adzuna, { appId: 'id', appKey: 'key', country: 'us' });
    assert.deepEqual(config.reed, { apiKey: 'reed' });
    assert.deepEqual(config.search.keywords, ['.NET', 'Azure']);
  });

  it('LoadConfig_IndexedKeywordsWithGap_StopsAtTheGap', () => {
    const config = loadConfig({ Search__Keywords__0: 'A', Search__Keywords__2: 'C' });

    assert.deepEqual(config.search.keywords, ['A']);
  });

  it('LoadConfig_CommaSeparatedKeywords_AreAccepted', () => {
    const config = loadConfig({ Search__Keywords: 'Blazor, F#' });

    assert.deepEqual(config.search.keywords, ['Blazor', ' F#']);
  });

  it('LoadConfig_FlakySources_AreTrimmed', () => {
    assert.deepEqual(loadConfig({ MOCK_FLAKY_SOURCES: ' Reed , JobServe' }).mockFlakySources, ['Reed', 'JobServe']);
  });

  it('LoadConfig_FailingSources_AreTrimmed', () => {
    const config = loadConfig({ MOCK_FAILING_SOURCES: ' Reed , JobServe,' });

    assert.deepEqual(config.mockFailingSources, ['Reed', 'JobServe']);
  });
});
