/**
 * Escapes like .NET's Uri.EscapeDataString (RFC 3986): everything but unreserved characters.
 * encodeURIComponent leaves !'()* alone, so they're escaped here.
 * @param {string} value
 */
export const escapeDataString = (value) =>
  encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const QueryString = Object.freeze({
  /**
   * Builds an escaped query string, skipping null or blank values.
   * @param {Record<string, string | null | undefined> | Iterable<[string, string | null | undefined]>} parameters
   */
  build(parameters) {
    const entries = Symbol.iterator in Object(parameters) ? [...parameters] : Object.entries(parameters);
    return entries
      .filter(([, value]) => value !== null && value !== undefined && value.trim().length > 0)
      .map(([key, value]) => `${escapeDataString(key)}=${escapeDataString(value)}`)
      .join('&');
  },
});
