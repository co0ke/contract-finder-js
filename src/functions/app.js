import { readFileSync } from 'node:fs';
import { AppConstants } from '../constants/appConstants.js';
import { effectiveKeywords } from './searchOptions.js';

// Read once per process, like the C# Lazy<string> over the embedded resource.
const cached = new Map();
const fileText = (path) => {
  if (!cached.has(path)) {
    cached.set(path, readFileSync(path, 'utf8'));
  }
  return cached.get(path);
};

const HtmlEscapes = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value) => value.replace(/[&<>"']/g, (c) => HtmlEscapes[c]);

/**
 * Serves the search page, with the default keywords in a data attribute for app.js to read. The page calls
 * /api/jobs, forwarding any ?code= function key from its own URL.
 * Anonymous so the page loads without a key; the jobs API it calls still requires one when deployed.
 *
 * @param {object} deps
 * @param {import('./searchOptions.js').SearchOptions} deps.options
 * @returns {(request?: unknown) => { status: number, body: string, headers: Record<string, string> }}
 */
export function createAppHandler({ options }) {
  const pageWithDefaultKeywords = () =>
    fileText(AppConstants.PagePath).replace(AppConstants.KeywordsPlaceholder, escapeHtml(effectiveKeywords(options).join(', ')));

  return function app() {
    return { status: 200, body: pageWithDefaultKeywords(), headers: { 'Content-Type': AppConstants.HtmlContentType } };
  };
}

/**
 * Serves the page's script (GET /api/app.js, so the page's relative `app.js` resolves to it). Static: the
 * page carries anything that depends on configuration.
 * @returns {(request?: unknown) => { status: number, body: string, headers: Record<string, string> }}
 */
export function createAppScriptHandler() {
  return function appScript() {
    return {
      status: 200,
      body: fileText(AppConstants.ScriptPath),
      headers: { 'Content-Type': AppConstants.JavaScriptContentType, 'Cache-Control': AppConstants.ScriptCacheControl },
    };
  };
}
