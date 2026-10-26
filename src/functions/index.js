// Registers the functions with the Azure Functions Node.js v4 programming model (package.json "main").
// Each handler is built by composition.js, so the same code runs under the Functions host and src/server.js.
import { app } from '@azure/functions';
import { CleanupConstants } from '../constants/cleanupConstants.js';
import { getApp } from '../composition.js';

app.http('App', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'app',
  handler: async (request) => (await getApp()).handlers.app(request),
});

app.http('AppScript', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'app.js',
  handler: async (request) => (await getApp()).handlers.appScript(request),
});

app.http('GetJobs', {
  methods: ['GET'],
  authLevel: 'function',
  route: 'jobs',
  handler: async (request) => (await getApp()).handlers.getJobs(request),
});

app.timer('CleanUpJobs', {
  schedule: CleanupConstants.Schedule,
  handler: async (timer) => (await getApp()).handlers.cleanUpJobs(timer),
});
