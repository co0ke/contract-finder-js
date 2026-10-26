import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAppHandler, createAppScriptHandler } from '../../src/functions/app.js';
import { createSearchOptions } from '../../src/functions/searchOptions.js';

const newApp = (...keywords) => createAppHandler({ options: createSearchOptions({ keywords }) });

const request = () => ({ query: new URLSearchParams() });

describe('App', () => {
  it('Run_AnyRequest_ReturnsSearchPageAsHtml', () => {
    const content = newApp()(request());

    assert.equal(content.status, 200);
    assert.equal(content.headers['Content-Type'], 'text/html; charset=utf-8');
    assert.match(content.body, /<title>Contract Finder<\/title>/);
  });

  it('Run_AnyRequest_PageHasNoInlineScript', () => {
    // All behaviour is in app.js, so a strict Content-Security-Policy could allow only 'self'.
    const { body } = newApp()(request());

    assert.deepEqual(body.match(/<script[^>]*>[\s\S]*?<\/script>/g), ['<script src="app.js"></script>']);
    assert.ok(!/\son[a-z]+=/i.test(body), 'no inline event handler attributes');
  });

  it('Run_KeywordsConfigured_ServesThemInPage', () => {
    const content = newApp('Rust', 'Go')(request());

    assert.ok(content.body.includes('<html lang="en" data-default-keywords="Rust, Go">'));
  });

  it('Run_NoKeywordsConfigured_ServesBuiltInDefaults', () => {
    const content = newApp()(request());

    assert.ok(content.body.includes('data-default-keywords=".NET, C#, Azure, backend engineer, software engineer"'));
  });

  it('Run_KeywordContainsMarkup_EscapesItInAttribute', () => {
    const content = newApp('"><script>alert(1)</script>', "C&'D")(request());

    assert.ok(!content.body.includes('<script>alert'));
    assert.ok(content.body.includes('data-default-keywords="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;, C&amp;&#39;D"'));
  });
});

describe('AppScript', () => {
  it('Run_AnyRequest_ReturnsPageScriptAsJavaScript', () => {
    const content = createAppScriptHandler()(request());

    assert.equal(content.status, 200);
    assert.equal(content.headers['Content-Type'], 'text/javascript; charset=utf-8');
    assert.equal(content.headers['Cache-Control'], 'public, max-age=300');
    assert.match(content.body, /'use strict'/);
  });

  it('Run_PageLoaded_CallsJobsApiRelativeToItself', () => {
    // The page is served at /api/app, so "jobs" resolves to /api/jobs.
    const content = createAppScriptHandler()(request());

    assert.ok(content.body.includes('fetch(`jobs?${params}`)'));
  });

  it('Run_AnyRequest_ReadsDefaultKeywordsFromThePage', () => {
    const content = createAppScriptHandler()(request());

    assert.ok(content.body.includes('document.documentElement.dataset.defaultKeywords'));
  });
});
