// Runs the daily cleanup once, for when the app isn't hosted with a timer trigger.
import { getApp } from './composition.js';

const application = await getApp();
await application.handlers.cleanUpJobs();
