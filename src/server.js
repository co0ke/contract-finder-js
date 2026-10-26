// A plain Node HTTP server for running and trying the app without the Azure Functions host.
// Routes match the Functions app: GET /api/app (the page) and GET /api/jobs (the API).
import { createServer } from 'node:http';
import { CleanupConstants } from './constants/cleanupConstants.js';
import { getApp } from './composition.js';
import { scheduleDailyUtc } from './scheduler.js';

const port = Number(process.env.PORT ?? 7071);

/**
 * Writes an Azure Functions style response ({ status, jsonBody | body, headers }) to Node's response.
 * @param {import('node:http').ServerResponse} res
 */
function write(res, { status = 200, jsonBody, body, headers = {} }) {
  const payload = jsonBody !== undefined ? JSON.stringify(jsonBody) : body ?? '';
  res.writeHead(status, {
    'Content-Type': jsonBody !== undefined ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(payload);
}

const application = await getApp();

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const request = { method: req.method, url: url.toString(), query: url.searchParams, headers: req.headers };
  try {
    if (req.method !== 'GET') {
      write(res, { status: 405, body: 'Method Not Allowed' });
    } else if (url.pathname === '/api/app') {
      write(res, application.handlers.app(request));
    } else if (url.pathname === '/api/app.js') {
      write(res, application.handlers.appScript(request));
    } else if (url.pathname === '/api/jobs') {
      write(res, await application.handlers.getJobs(request));
    } else if (url.pathname === '/') {
      res.writeHead(302, { Location: '/api/app' });
      res.end();
    } else {
      write(res, { status: 404, body: 'Not Found' });
    }
  } catch (error) {
    console.error(`${req.method} ${req.url} failed`, error);
    write(res, { status: 500, body: 'Internal Server Error' });
  }
});

server.listen(port, () => {
  const mode = application.config.mockExternals ? 'mock store and job sites' : 'live job sites and Table Storage';
  console.log(`Contract Finder listening on http://localhost:${port}/api/app (${mode})`);
});

// The timer trigger's job, on the same daily schedule.
if ((process.env.RUN_CLEANUP_SCHEDULE ?? 'true').toLowerCase() !== 'false') {
  scheduleDailyUtc(CleanupConstants.ScheduleUtc, () => application.handlers.cleanUpJobs());
}
