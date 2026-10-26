/**
 * The slice of a logger the services use. Azure Functions' InvocationContext and console both fit.
 * @typedef {{ info: (...args: unknown[]) => void, warn: (...args: unknown[]) => void, error: (...args: unknown[]) => void }} Logger
 */

/** @type {Logger} */
export const consoleLogger = Object.freeze({
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
});

/** The equivalent of NullLogger: swallows everything. */
/** @type {Logger} */
export const nullLogger = Object.freeze({ info() {}, warn() {}, error() {} });
