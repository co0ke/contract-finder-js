// The search page's script. Loaded synchronously from <head>, so the theme is applied before anything is
// painted; everything else waits for the DOM. No inline script: the page only carries data attributes.
(() => {
  'use strict';

  const PREFS_KEY = 'contract-finder:prefs';

  // Browser storage can be unavailable (private mode, blocked site data): the page must still work.
  const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ } },
  };

  const deviceDark = matchMedia('(prefers-color-scheme: dark)');

  // "system" follows the device setting; "light" and "dark" are the user's choice.
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'system' ? (deviceDark.matches ? 'dark' : 'light') : theme;
  }

  const savedTheme = () => {
    const theme = store.get(PREFS_KEY, {}).theme;
    return ['light', 'dark'].includes(theme) ? theme : 'system';
  };

  // Before first paint: <html> exists as soon as parsing starts, the rest of the page doesn't yet.
  applyTheme(savedTheme());

  document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('search');
    const fields = form.elements;
    const button = form.querySelector('button');
    const statusEl = document.getElementById('status');
    const results = document.getElementById('results');
    const toolbar = document.getElementById('toolbar');
    const summary = document.getElementById('summary');
    const sources = document.getElementById('sources');
    const sort = document.getElementById('sort');
    const newOnly = document.getElementById('newOnly');
    const theme = document.getElementById('theme');

    // When deployed, the API needs a function key; forward ?code= from this page's URL.
    const functionKey = new URLSearchParams(location.search).get('code');

    let jobs = [];
    let sourceStatuses = [];
    // Sources the user has switched off. Storing these, not the selected ones, means a new source starts on.
    const hiddenSources = new Set(store.get(PREFS_KEY, {}).hiddenSources || []);
    // The keywords the server searches when none are given; it puts them on <html> when it serves this page.
    const defaultKeywords = document.documentElement.dataset.defaultKeywords || '';
    const normaliseKeywords = value => value.split(',').map(k => k.trim()).filter(Boolean).join(', ');

    const money = n => '£' + Math.round(n).toLocaleString('en-GB');
    const safeUrl = url => /^https?:\/\//i.test(url) ? url : '#';
    // Snippets can contain HTML highlighting; parse to plain text without executing anything.
    const plainText = html => new DOMParser().parseFromString(html || '', 'text/html').body.textContent.trim();

    function formatRate(j) {
      const { dayRateMin: min, dayRateMax: max } = j;
      if (min == null && max == null) return null;
      const text = min != null && max != null && min !== max ? `${money(min)}–${money(max)}` : money(min ?? max);
      return `${text}/day`;
    }

    function formatAge(iso) {
      if (!iso) return 'Date unknown';
      const days = Math.floor((Date.now() - new Date(iso)) / 86_400_000);
      return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : `${days} days ago`;
    }

    function el(tag, props = {}, ...children) {
      const node = Object.assign(document.createElement(tag), props);
      node.append(...children.filter(c => c != null));
      return node;
    }

    function render() {
      const minRate = Number(fields.minRate.value) || 0;
      let matching = jobs.filter(j => !minRate || (j.dayRateMax ?? j.dayRateMin ?? 0) >= minRate);
      if (newOnly.checked) matching = matching.filter(j => j.isNew);

      // The chips count what each source has left after the other filters, i.e. what switching it on would show.
      const listedBySource = new Map();
      for (const j of matching) listedBySource.set(j.source, (listedBySource.get(j.source) ?? 0) + 1);
      renderSources(listedBySource);

      let list = matching.filter(j => !hiddenSources.has(j.source));

      const byDate = (a, b) => (b.postedAt ? Date.parse(b.postedAt) : 0) - (a.postedAt ? Date.parse(a.postedAt) : 0);
      const byRate = (a, b) => (b.dayRateMax ?? b.dayRateMin ?? -1) - (a.dayRateMax ?? a.dayRateMin ?? -1);
      list.sort(sort.value === 'rate' ? (a, b) => byRate(a, b) || byDate(a, b) : byDate);

      const newCount = jobs.filter(j => j.isNew).length;
      summary.textContent = `${list.length} of ${jobs.length} roles · ${newCount} new since the last search`;

      results.replaceChildren(...list.map(j => {
        const rate = formatRate(j);
        return el('li', { className: j.isNew ? '' : 'seen' },
          el('div', { className: 'row' },
            el('a', { className: 'title', href: safeUrl(j.url), target: '_blank', rel: 'noopener noreferrer', textContent: j.title }),
            el('span', {
              className: rate ? 'rate' : 'rate none',
              textContent: rate ? (j.rateIsEstimated ? `~${rate}` : rate) : 'Rate not given',
              title: j.rateIsEstimated ? 'Estimated by the job site, not stated in the advert' : '',
            })),
          el('div', { className: 'meta' },
            j.isNew ? el('span', { className: 'badge', textContent: 'NEW' }) : null,
            j.relevance === 'Generic'
              ? el('span', { className: 'tag', textContent: 'No stack named', title: 'A software role that names no language or stack' })
              : null,
            el('span', { textContent: [j.company, j.location].filter(Boolean).join(' · ') || 'Unknown company' }),
            el('span', { textContent: formatAge(j.postedAt) }),
            el('span', { textContent: j.source })),
          j.snippet ? el('p', { className: 'snippet', textContent: plainText(j.snippet) }) : null);
      }));

      statusEl.hidden = list.length > 0;
      statusEl.className = 'status';
      if (!list.length) {
        // Failed sources have no chip to switch off, so "all hidden" means everything else that matched is.
        const allHidden = matching.length > 0;
        if (allHidden) {
          statusEl.replaceChildren('No sources selected.',
            el('button', { type: 'button', textContent: 'Show all', onclick: () => { hiddenSources.clear(); savePrefs(); render(); } }));
        } else {
          statusEl.textContent = jobs.length ? 'No roles match these filters.' : 'No roles found. Try a wider date range.';
        }
      }
    }

    const errorMessages = errors => (errors || []).map(e => e.message).join(' ');

    function renderSources(listedBySource) {
      sources.replaceChildren(...sourceStatuses.map(s => {
        const error = errorMessages(s.errors);
        const hidden = hiddenSources.has(s.name);
        const listed = listedBySource.get(s.name) ?? 0;
        const label = error ? `${s.name}: unavailable` : `${s.name}: ${listed}${s.warning ? ' ⚠' : ''}`;
        // A far lower count than usual often means the site changed and the source needs fixing.
        const detail = error || [`${s.count} returned by the last search`, s.warning].filter(Boolean).join('. ');
        return el('button', {
          type: 'button',
          className: error ? 'chip error' : s.warning ? 'chip warning' : 'chip',
          textContent: label,
          title: detail,
          ariaPressed: String(!hidden),
          // A failed or empty source has nothing to show, but a hidden one must stay clickable to get it back.
          disabled: !hidden && (!!error || listed === 0),
          onclick: () => {
            if (hidden) hiddenSources.delete(s.name); else hiddenSources.add(s.name);
            savePrefs();
            render();
          },
        });
      }));
    }

    async function search() {
      const params = new URLSearchParams();
      // Send keywords only when they differ from the defaults, so changes to the configured defaults show up.
      const q = normaliseKeywords(fields.q.value);
      if (q && q !== defaultKeywords) params.set('q', q);
      params.set('days', fields.days.value);
      if (functionKey) params.set('code', functionKey);

      button.disabled = true;
      button.textContent = 'Searching…';
      statusEl.hidden = false;
      statusEl.className = 'status';
      statusEl.textContent = 'Searching job sites…';
      results.replaceChildren();

      try {
        const response = await fetch(`jobs?${params}`);
        const body = await response.json().catch(() => null);
        if (!body) throw new Error(`The server returned ${response.status}.`);
        // Invalid input (400) and an unreachable store (503) return only errors.
        if (body.errors?.length) throw new Error(errorMessages(body.errors));

        // Show what was actually searched: the defaults fill an empty box.
        const searched = (body.keywords || []).join(', ');
        fields.q.value = searched;

        sourceStatuses = body.sources || [];
        jobs = body.jobs || [];
        toolbar.hidden = false;

        if (response.status === 502) {
          throw new Error('Every job site failed. Hover the source labels above for details.');
        }

        // The server marks adverts first seen by this search as new.
        render();
      } catch (err) {
        jobs = [];
        results.replaceChildren();
        statusEl.hidden = false;
        statusEl.className = 'status error';
        statusEl.textContent = err.message || 'Search failed.';
      } finally {
        button.disabled = false;
        button.textContent = 'Search';
      }
    }

    // Restore the last search settings.
    const prefs = store.get(PREFS_KEY, {});
    for (const name of ['days', 'minRate']) if (prefs[name] != null) fields[name].value = prefs[name];
    // Not "q": earlier versions saved their single-keyword box (".NET") there, which would override the defaults.
    fields.q.value = prefs.keywords || defaultKeywords;
    if (prefs.sort) sort.value = prefs.sort;
    theme.value = savedTheme();

    function savePrefs() {
      store.set(PREFS_KEY, {
        // Remember custom keywords only, so a returning visitor still gets the current defaults.
        keywords: normaliseKeywords(fields.q.value) === defaultKeywords ? '' : fields.q.value,
        days: fields.days.value, minRate: fields.minRate.value, sort: sort.value, theme: theme.value,
        hiddenSources: [...hiddenSources],
      });
    }

    form.addEventListener('submit', e => { e.preventDefault(); savePrefs(); search(); });
    fields.minRate.addEventListener('input', () => { savePrefs(); if (jobs.length) render(); });
    sort.addEventListener('change', () => { savePrefs(); render(); });
    theme.addEventListener('change', () => { savePrefs(); applyTheme(theme.value); });
    // Follow the device setting while on "system", including when it changes with the page open.
    deviceDark.addEventListener('change', () => applyTheme(theme.value));
    newOnly.addEventListener('change', render);
  });
})();
