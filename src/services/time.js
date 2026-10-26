/**
 * The equivalent of .NET's TimeProvider: the one place the current time comes from, so tests can fix it.
 * @typedef {{ now: () => Date }} TimeProvider
 */

/** @type {TimeProvider} */
export const systemTime = Object.freeze({ now: () => new Date() });
