// @flow
import uuid from 'uuid';
import zlib from 'zlib';
import {join as pathJoin} from 'path';
import {format as urlFormat, parse as urlParse} from 'url';
import {DEBOUNCE_MILLIS, getAppVersion, isDevelopment} from './constants';
import * as querystring from './querystring';
import {shell} from 'electron';

const URL_PATH_CHARACTER_WHITELIST = '+,;@=:';
const ESCAPE_REGEX_MATCH = /[-[\]/{}()*+?.\\^$|]/g;

type Header = {
  name: string,
  value: string
};

export function getBasicAuthHeader (username: ?string, password: ?string): Header {
  const name = 'Authorization';
  const header = `${username || ''}:${password || ''}`;
  const authString = Buffer.from(header, 'utf8').toString('base64');
  const value = `Basic ${authString}`;
  return {name, value};
}

export function getBearerAuthHeader (token: string): Header {
  const name = 'Authorization';
  const value = `Bearer ${token}`;
  return {name, value};
}

export function filterHeaders<T: Header> (headers: Array<T>, name: string): Array<T> {
  if (!Array.isArray(headers) || !name) {
    return [];
  }

  return headers.filter(h => {
    if (!h || !h.name) {
      return false;
    } else {
      return h.name.toLowerCase() === name.toLowerCase();
    }
  });
}

export function hasContentTypeHeader<T: Header> (headers: Array<T>): boolean {
  return filterHeaders(headers, 'content-type').length > 0;
}

export function hasContentLengthHeader<T: Header> (headers: Array<T>): boolean {
  return filterHeaders(headers, 'content-length').length > 0;
}

export function hasAuthHeader<T: Header> (headers: Array<T>): boolean {
  return filterHeaders(headers, 'authorization').length > 0;
}

export function hasAcceptHeader<T: Header> (headers: Array<T>): boolean {
  return filterHeaders(headers, 'accept').length > 0;
}

export function hasUserAgentHeader<T: Header> (headers: Array<T>): boolean {
  return filterHeaders(headers, 'user-agent').length > 0;
}

export function getSetCookieHeaders<T: Header> (headers: Array<T>): Array<T> {
  return filterHeaders(headers, 'set-cookie');
}

export function getContentTypeHeader<T: Header> (headers: Array<T>): T | null {
  const matches = filterHeaders(headers, 'content-type');
  return matches.length ? matches[0] : null;
}

export function getContentLengthHeader<T: Header> (headers: Array<T>): T | null {
  const matches = filterHeaders(headers, 'content-length');
  return matches.length ? matches[0] : null;
}

export function setDefaultProtocol (url: string, defaultProto: string = 'http:'): string {
  // If no url, don't bother returning anything
  if (!url) {
    return '';
  }

  // Default the proto if it doesn't exist
  if (url.indexOf('://') === -1) {
    url = `${defaultProto}//${url}`;
  }

  return url;
}

/**
 * Generate an ID of the format "<MODEL_NAME>_<TIMESTAMP><RANDOM>"
 * @param prefix
 * @returns {string}
 */
export function generateId (prefix: string): string {
  const id = uuid.v4().replace(/-/g, '');

  if (prefix) {
    return `${prefix}_${id}`;
  } else {
    return id;
  }
}

export function flexibleEncodeComponent (str: string, ignore: string = ''): string {
  // Sometimes spaces screw things up because of url.parse
  str = str.replace(/%20/g, ' ');

  const ignoredChars = ignore.split('');

  // Do a special encode of ignored chars, so they aren't touched.
  // This first pass, surrounds them with a special tag (anything unique
  // will work), so it can change them back later
  // Example: will replace %40 with __LEAVE_40_LEAVE__, and we'll change
  // it back to %40 at the end.
  for (const c of ignoredChars) {
    const code = encodeURIComponent(c).replace('%', '');

    // Replace encoded versions
    const re = new RegExp(encodeURIComponent(c), 'g');
    str = str.replace(re, `__ENCODED_${code}_ENCODED__`);

    // Replace raw versions
    const re2 = new RegExp(`[${c}]`, 'g');
    str = str.replace(re2, `__RAW_${code}_RAW__`);
  }

  try {
    str = decodeURIComponent(str);
  } catch (e) {
    // Malformed (probably not encoded) so assume it's decoded already
  }

  // Encode it
  str = encodeURIComponent(str);

  // Put back the encoded version of the ignored chars
  for (const c of ignoredChars) {
    const code = encodeURIComponent(c).replace('%', '');

    // Put back encoded versions
    const re = new RegExp(`__ENCODED_${code}_ENCODED__`, 'g');
    str = str.replace(re, encodeURIComponent(c));

    // Put back raw versions
    const re2 = new RegExp(`__RAW_${code}_RAW__`, 'g');
    str = str.replace(re2, c);
  }

  return str;
}

export function prepareUrlForSending (url: string, autoEncode: boolean = true): string {
  const urlWithProto = setDefaultProtocol(url);

  if (!autoEncode) {
    return urlWithProto;
  } else {
    // Parse the URL into components
    const parsedUrl = urlParse(urlWithProto);

    // ~~~~~~~~~~~ //
    // 1. Pathname //
    // ~~~~~~~~~~~ //

    if (parsedUrl.pathname) {
      const segments = parsedUrl.pathname.split('/');
      parsedUrl.pathname = segments.map(
        s => flexibleEncodeComponent(s, URL_PATH_CHARACTER_WHITELIST)
      ).join('/');
    }

    // ~~~~~~~~~~~~~~ //
    // 2. Querystring //
    // ~~~~~~~~~~~~~~ //

    if (parsedUrl.query) {
      const qsParams = querystring.deconstructToParams(parsedUrl.query);
      const encodedQsParams = [];
      for (const {name, value} of qsParams) {
        encodedQsParams.push({
          name: flexibleEncodeComponent(name),
          value: flexibleEncodeComponent(value)
        });
      }

      parsedUrl.query = querystring.buildFromParams(encodedQsParams);
      parsedUrl.search = `?${parsedUrl.query}`;
    }

    return urlFormat(parsedUrl);
  }
}

export function delay (milliseconds: number = DEBOUNCE_MILLIS): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function removeVowels (str: string): string {
  return str.replace(/[aeiouyAEIOUY]/g, '');
}

export function keyedDebounce (callback: Function, millis: number = DEBOUNCE_MILLIS): Function {
  let timeout = null;
  let results = {};

  return function (key, ...args) {
    results[key] = args;

    clearTimeout(timeout);
    timeout = setTimeout(() => {
      if (!Object.keys(results).length) {
        return;
      }

      callback(results);
      results = {};
    }, millis);
  };
}

export function debounce (callback: Function, millis: number = DEBOUNCE_MILLIS): Function {
  // For regular debounce, just use a keyed debounce with a fixed key
  return keyedDebounce(results => {
    callback.apply(null, results['__key__']);
  }, millis).bind(null, '__key__');
}

export function describeByteSize (bytes: number, long: boolean = false): string {
  bytes = Math.round(bytes * 10) / 10;
  let size;

  // NOTE: We multiply these by 2 so we don't end up with
  // values like 0 GB

  let unit = long ? 'bytes' : 'B';
  if (bytes < 1024 * 2) {
    size = bytes;
    unit = long ? 'bytes' : 'B';
  } else if (bytes < 1024 * 1024 * 2) {
    size = bytes / 1024;
    unit = long ? 'kilobytes' : 'KB';
  } else if (bytes < 1024 * 1024 * 1024 * 2) {
    size = bytes / 1024 / 1024;
    unit = long ? 'megabytes' : 'MB';
  } else {
    size = bytes / 1024 / 1024 / 1024;
    unit = long ? 'gigabytes' : 'GB';
  }

  const rounded = (Math.round(size * 10) / 10);
  return `${rounded} ${unit}`;
}

export function nullFn (): void {
  // Do nothing
}

export function preventDefault (e: Event): void {
  e.preventDefault();
}

export function clickLink (href: string): void {
  if (href.match(/^http/i)) {
    const appName = isDevelopment() ? 'Insomnia Dev' : 'Insomnia';
    const qs = `utm_source=${appName}&utm_medium=app&utm_campaign=v${getAppVersion()}`;
    const attributedHref = querystring.joinUrl(href, qs);
    shell.openExternal(attributedHref);
  } else {
    // Don't modify non-http urls
    shell.openExternal(href);
  }
}

export function fnOrString (v: string | Function, ...args: Array<any>) {
  if (typeof v === 'string') {
    return v;
  } else {
    return v(...args);
  }
}

export function compressObject (obj: any): string {
  const compressed = compress(JSON.stringify(obj));
  return compressed.toString('base64');
}

export function decompressObject (input: string): any {
  const jsonBuffer = decompress(Buffer.from(input, 'base64'));
  return JSON.parse(jsonBuffer.toString('utf8'));
}

export function compress (inputBuffer: Buffer | string): Buffer {
  return zlib.gzipSync(inputBuffer);
}

export function decompress (inputBuffer: Buffer | string): Buffer {
  return zlib.gunzipSync(inputBuffer);
}

export function resolveHomePath (p: string): string {
  if (p.indexOf('~/') === 0) {
    return pathJoin(process.env.HOME || '/', p.slice(1));
  } else {
    return p;
  }
}

export function jsonParseOr (str: string, fallback: any): any {
  try {
    return JSON.parse(str);
  } catch (err) {
    return fallback;
  }
}

/**
 * Escape a dynamic string for use inside of a regular expression
 * @param str - string to escape
 * @returns {string} escaped string
 */
export function escapeRegex (str: string): string {
  return str.replace(ESCAPE_REGEX_MATCH, '\\$&');
}

export function fuzzyMatch (searchString: string, text: string): boolean {
  const regexSearchString = escapeRegex(searchString.toLowerCase()).split('').join('.*');
  const toMatch = new RegExp(regexSearchString);
  return toMatch.test(text.toLowerCase());
}
