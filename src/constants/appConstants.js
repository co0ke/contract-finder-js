export const AppConstants = Object.freeze({
  /** What `index.html` holds, in the `data-default-keywords` attribute on `<html>`, where the defaults are injected. */
  KeywordsPlaceholder: '{{DEFAULT_KEYWORDS}}',

  /** The search page and its script, relative to this module. */
  PagePath: new URL('../wwwroot/index.html', import.meta.url),
  ScriptPath: new URL('../wwwroot/app.js', import.meta.url),

  HtmlContentType: 'text/html; charset=utf-8',
  JavaScriptContentType: 'text/javascript; charset=utf-8',

  /** The script changes only with a deployment; let browsers keep it a while, then revalidate. */
  ScriptCacheControl: 'public, max-age=300',
});
