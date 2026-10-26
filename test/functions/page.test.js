// Runs the search page's own scripts in jsdom, to check the behaviour the App function can't: theme handling.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JSDOM, VirtualConsole } from 'jsdom';
import { createAppHandler, createAppScriptHandler } from '../../src/functions/app.js';
import { createSearchOptions } from '../../src/functions/searchOptions.js';

const PrefsKey = 'contract-finder:prefs';
const ScriptTag = '<script src="app.js"></script>';

// jsdom won't fetch app.js from a server that isn't there, so the script is inlined where the tag sits;
// that keeps the real load order (run from <head>, before the body is parsed).
const script = createAppScriptHandler()().body;
const page = createAppHandler({ options: createSearchOptions({ keywords: ['Blazor', 'F#'] }) })().body;
assert.ok(page.includes(ScriptTag));
const html = page.replace(ScriptTag, `<script>${script}</script>`);

/**
 * Loads the page with a fake device colour scheme and optional saved preferences, and waits for it to
 * initialise (app.js does its wiring on DOMContentLoaded, which jsdom fires asynchronously).
 * @param {{ deviceDark?: boolean, prefs?: object }} options
 */
async function loadPage({ deviceDark = false, prefs = null } = {}) {
  const listeners = new Set();
  const media = { matches: deviceDark, addEventListener: (_, fn) => listeners.add(fn) };
  // An uncaught error in the page's scripts is a test failure, not something to read in the log.
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => { throw error.detail ?? error; });
  const dom = new JSDOM(html, {
    url: 'http://localhost:7071/api/app',
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      // jsdom has no matchMedia; the page reads it in <head>, so it must exist before parsing.
      window.matchMedia = () => media;
      if (prefs) {
        window.localStorage.setItem(PrefsKey, JSON.stringify(prefs));
      }
    },
  });
  await loaded(dom);
  return {
    dom,
    theme: () => dom.window.document.documentElement.dataset.theme,
    select: dom.window.document.getElementById('theme'),
    savedPrefs: () => JSON.parse(dom.window.localStorage.getItem(PrefsKey)),
    setDeviceDark(value) {
      media.matches = value;
      for (const fn of listeners) fn();
    },
    choose(value) {
      this.select.value = value;
      this.select.dispatchEvent(new dom.window.Event('change'));
    },
  };
}

const loaded = (dom) => new Promise((resolve) => {
  if (dom.window.document.readyState !== 'loading') {
    resolve();
  } else {
    dom.window.document.addEventListener('DOMContentLoaded', () => resolve());
  }
});

describe('search page', () => {
  it('Load_AnyPage_RunsItsScriptsWithoutErrors', async () => {
    const page = await loadPage({ prefs: { days: '3', minRate: '400', sort: 'rate', keywords: 'Blazor', hiddenSources: ['Reed'] } });

    const document = page.dom.window.document;
    assert.equal(document.getElementById('search').elements.q.value, 'Blazor');
    assert.equal(document.documentElement.dataset.defaultKeywords, 'Blazor, F#');
    assert.equal(document.getElementById('search').elements.days.value, '3');
    assert.equal(document.getElementById('sort').value, 'rate');
  });
});

describe('search page keywords', () => {
  it('Load_NoSavedKeywords_FillsBoxWithServerDefaults', async () => {
    const page = await loadPage();

    assert.equal(page.dom.window.document.getElementById('search').elements.q.value, 'Blazor, F#');
  });
});

describe('search page theme', () => {
  it('Load_NoPreference_FollowsDeviceSetting', async () => {
    assert.equal((await loadPage({ deviceDark: false })).theme(), 'light');
    assert.equal((await loadPage({ deviceDark: true })).theme(), 'dark');
    assert.equal((await loadPage()).select.value, 'system');
  });

  it('Load_DeviceSettingChangesWhileOpen_FollowsIt', async () => {
    const page = await loadPage({ deviceDark: false });

    page.setDeviceDark(true);

    assert.equal(page.theme(), 'dark');
  });

  it('Choose_Dark_AppliesAndSavesWithOtherPreferences', async () => {
    const page = await loadPage({ deviceDark: false, prefs: { days: '3', hiddenSources: ['Reed'] } });

    page.choose('dark');

    assert.equal(page.theme(), 'dark');
    const saved = page.savedPrefs();
    assert.equal(saved.theme, 'dark');
    assert.deepEqual([saved.days, saved.hiddenSources], ['3', ['Reed']]);
  });

  it('Choose_Light_IgnoresDeviceSetting', async () => {
    const page = await loadPage({ deviceDark: true });

    page.choose('light');
    page.setDeviceDark(false);
    page.setDeviceDark(true);

    assert.equal(page.theme(), 'light');
  });

  it('Load_SavedTheme_AppliesItBeforeTheBodyIsParsed', async () => {
    // The script runs from <head>, so the theme is set before anything is painted.
    const headOnly = html.slice(0, html.indexOf('</head>') + '</head>'.length);
    const media = { matches: false, addEventListener() {} };
    const dom = new JSDOM(headOnly, {
      url: 'http://localhost:7071/api/app',
      runScripts: 'dangerously',
      beforeParse(window) {
        window.matchMedia = () => media;
        window.localStorage.setItem(PrefsKey, JSON.stringify({ theme: 'dark' }));
      },
    });

    assert.equal(dom.window.document.documentElement.dataset.theme, 'dark');
  });

  it('Load_SavedThemeInvalid_FallsBackToSystem', async () => {
    const page = await loadPage({ deviceDark: true, prefs: { theme: 'sepia' } });

    assert.equal(page.select.value, 'system');
    assert.equal(page.theme(), 'dark');
  });

  it('Load_StorageUnavailable_StillRenders', async () => {
    const dom = new JSDOM(html, {
      url: 'http://localhost:7071/api/app',
      runScripts: 'dangerously',
      beforeParse(window) {
        window.matchMedia = () => ({ matches: false, addEventListener() {} });
        Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } });
      },
    });
    await loaded(dom);

    assert.equal(dom.window.document.documentElement.dataset.theme, 'light');
    assert.equal(dom.window.document.getElementById('theme').value, 'system');
  });
});
