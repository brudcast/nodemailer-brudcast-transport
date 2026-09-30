import { name as packageName, version as packageVersion } from "../package.json";
import { BrudcastError } from "./errors";
import { buildPayload } from "./payload";
import { brudcastSmtp } from "./smtp";
import type {
  BrudcastResponse,
  BrudcastSentMessageInfo,
  BrudcastSmtpOptions,
  BrudcastSmtpTransportOptions,
  BrudcastTransportOptions,
  NormalizableMail,
  NormalizedMail
} from "./types";

export const DEFAULT_URL = "https://mailing-service.brudcast.com";
export const SEND_PATH = "/api/v1/send";
export const DEFAULT_TIMEOUT = 30_000;
export const MESSAGE_ID_DOMAIN = "brudcast-mailing-service";

type Callback<T> = (error: Error | null, result: T) => void;

export interface BrudcastTransport {
  name: "Brudcast";
  version: string;
  options: BrudcastTransportOptions;
  send(mail: NormalizableMail, callback: Callback<BrudcastSentMessageInfo>): void;
  verify(): Promise<true>;
  verify(callback: Callback<true>): void;
  isIdle(): boolean;
  close(): void;
}

interface ResolvedOptions {
  apiKey: string;
  url: URL;
  timeout: number;
}

type SendResult = BrudcastResponse<{ jobId: string }>;

/**
 * Read the sending key from `auth.apiKey`, `auth.api_key` or `apiKey`, in that order
 *
 * A value that is not a string is skipped. The key is trimmed of ASCII whitespace, since the
 * service matches it exactly and a secret store can leave a trailing newline, and a blank one is
 * skipped too. The characters of the key are checked when the API transport is created.
 *
 * @param options - The transport options
 * @returns The first trimmed key that is not blank, or undefined when there is none
 */
const resolveApiKey = (options: BrudcastTransportOptions): string | undefined =>
  [options.auth?.apiKey, options.auth?.api_key, options.apiKey]
    .map(candidate =>
      typeof candidate === "string" ? candidate.replace(/^[ \t\n\r\v\f]+|[ \t\n\r\v\f]+$/g, "") : ""
    )
    .find(Boolean);

/**
 * Read the `insecure` option the way PHP's boolean filter does, so an environment variable such
 * as `"true"` or `"1"` enables it
 *
 * @param value - The `insecure` option
 * @returns Whether plain http is allowed
 */
const isInsecure = (value: unknown): boolean =>
  value === true ||
  value === 1 ||
  (typeof value === "string" && ["1", "true", "on", "yes"].includes(value.trim().toLowerCase()));

/**
 * A sending key is visible ASCII only. Anything else could not be sent in the Authorization
 * header, and the error fetch would raise for it quotes the key.
 */
const API_KEY_PATTERN = /^[\x21-\x7E]+$/;

/**
 * The longest delay a timer supports; a longer one fires at once
 */
const MAX_TIMEOUT = 2 ** 31 - 1;

/**
 * A timeout given as text: digits with an optional fraction, between ASCII whitespace
 */
const TIMEOUT_PATTERN = /^[ \t\n\r\v\f]*[0-9]+(\.[0-9]+)?[ \t\n\r\v\f]*$/;

/**
 * Read the request timeout, accepting a number or a numeric string such as an environment
 * variable
 *
 * @param value - The `timeout` option, in milliseconds
 * @returns The timeout rounded up to whole milliseconds
 * @throws {TypeError} When the timeout is not a positive number, or is longer than a timer
 * supports once rounded up
 */
const resolveTimeout = (value: unknown): number => {
  if (value === undefined || value === null) {
    return DEFAULT_TIMEOUT;
  }
  const timeout = Math.ceil(
    typeof value === "number"
      ? value
      : typeof value === "string" && TIMEOUT_PATTERN.test(value)
        ? Number(value)
        : Number.NaN
  );
  if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_TIMEOUT) {
    throw new TypeError(
      `The Brudcast timeout must be a positive number of milliseconds no greater than ${MAX_TIMEOUT}.`
    );
  }
  return timeout;
};

const isSmtpOptions = (
  options: BrudcastTransportOptions | BrudcastSmtpOptions
): options is BrudcastSmtpOptions => {
  const auth = options.auth as { user?: unknown; pass?: unknown } | undefined;
  return auth?.user !== undefined || auth?.pass !== undefined;
};

const normalize = (mail: NormalizableMail): Promise<NormalizedMail> =>
  new Promise((resolve, reject) =>
    mail.normalize((error, data) => (error ? reject(error) : resolve(data)))
  );

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/**
 * Read the service's response envelope from a send response
 *
 * A redirect is not followed, since a redirected POST turns into a GET without its body, so it
 * fails with the target in the message. A 2xx without a JSON body, as a proxy in front of the
 * service may send, counts as sent: the message may be queued by then, and failing it would
 * send it again on retry. For the same reason, a body that fails to arrive after the status has
 * (a timeout or reset mid-body) is treated as empty, never as the service being unreachable. Any
 * other body that is not JSON becomes the failure message.
 *
 * @param response - The response to the send request
 * @returns The parsed envelope, or one built from the status when the body is not a JSON object
 */
const parseBody = async (response: Response): Promise<SendResult> => {
  if (response.status >= 300 && response.status < 400) {
    return {
      status: false,
      message: `The Brudcast url redirected to "${response.headers.get("location") ?? ""}"; set url to the final URL`
    };
  }
  const text = await response.text().catch(() => "");
  const body = text ? parseJson(text) : undefined;
  if (typeof body === "object" && body !== null) {
    return body as SendResult;
  }
  return response.ok || !text ? { status: response.ok } : { status: false, message: text };
};

/**
 * Prepare a service URL for an error message
 *
 * The query and fragment are dropped, since they can carry tokens, then anything between `://` (or
 * the start, when there is none) and the last `@` is replaced with `***`, so a username or password
 * never reaches a log however malformed the URL is.
 *
 * @param url - The configured service URL, as text
 * @returns The URL without credentials, query or fragment
 */
const redactUrl = (url: string): string => {
  const base = url.replace(/[?#][\s\S]*$/, "");
  const scheme = base.indexOf("://");
  const start = scheme === -1 ? 0 : scheme + 3;
  const at = base.lastIndexOf("@");
  return at < start ? base : `${base.slice(0, start)}***${base.slice(at)}`;
};

/**
 * A URL as the transport accepts it: a scheme followed by `://`, with no whitespace, backslash
 * or control character anywhere, since URL parsers disagree on those
 */
// eslint-disable-next-line no-control-regex -- control characters are what it refuses
const URL_SHAPE_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s\\\x00-\x1F\x7F]*$/;

/**
 * Build the send endpoint from the configured service URL
 *
 * The URL must be absolute, start with a scheme and `://`, have a host and carry no username or
 * password. Whitespace, backslashes and control characters are refused rather than cleaned up,
 * since URL parsers disagree on them. The send path is appended to any path the URL already has,
 * so the service can sit behind a prefix, and any query or fragment is dropped. Every request
 * carries the sending key, so plain http is refused unless the transport opts in with
 * `insecure`. An error message quotes the URL only without its credentials, query and fragment.
 *
 * @param base - The configured service URL
 * @param insecure - Whether an http URL is allowed
 * @returns The send endpoint
 * @throws {TypeError} When the URL is not valid, carries credentials, or is not https and http is
 * not allowed
 */
const resolveSendUrl = (base: unknown, insecure: boolean): URL => {
  const invalid = () =>
    new TypeError(`The Brudcast url "${redactUrl(String(base))}" is not a valid URL.`);
  if (typeof base !== "string" || !URL_SHAPE_PATTERN.test(base) || !URL.canParse(base)) {
    throw invalid();
  }
  const url = new URL(base);
  const authority = /^[^:]*:\/\/([^/?#]*)/.exec(base)?.[1] ?? "";
  if (!url.hostname || authority === "") {
    throw invalid();
  }
  if (authority.includes("@") || url.username || url.password) {
    throw new TypeError("The Brudcast url must not include a username or password.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && insecure)) {
    throw new TypeError(
      `nodemailer-brudcast-transport requires an https url, not "${redactUrl(base)}"; set insecure to allow http`
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${SEND_PATH}`;
  url.search = "";
  url.hash = "";
  return url;
};

/**
 * Send a request to the service and read its response envelope
 *
 * @param options - The resolved transport options
 * @param payload - The request body
 * @returns The response and its envelope
 * @throws {BrudcastError} With status code 0 when the service cannot be reached or the request
 * times out
 */
const post = async (
  options: ResolvedOptions,
  payload: unknown
): Promise<{ response: Response; body: SendResult }> => {
  try {
    const response = await fetch(options.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Bearer ${options.apiKey}`,
        "User-Agent": `${packageName}/${packageVersion}`
      },
      body: JSON.stringify(payload),
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeout)
    });
    return { response, body: await parseBody(response) };
  } catch (error) {
    const message = `Could not reach the Brudcast mailing service: ${error instanceof Error ? error.message : String(error)}`;
    throw new BrudcastError(message, 0, { status: false, message }, { cause: error });
  }
};

const nonEmptyString = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

const MONTH = `(?<month>${MONTHS.join("|")})`;
const TIME = "(?<hours>[0-9]{2}):(?<minutes>[0-9]{2}):(?<seconds>[0-9]{2})";
const WEEKDAY = `(?<weekday>${WEEKDAYS.join("|")})`;

/**
 * The HTTP-date formats RFC 9110 requires a recipient to accept: IMF-fixdate, then the obsolete
 * RFC 850 and asctime formats
 */
const HTTP_DATE_PATTERNS = [
  new RegExp(`^${WEEKDAY}, (?<day>[0-9]{2}) ${MONTH} (?<year>[0-9]{4}) ${TIME} GMT$`),
  new RegExp(
    `^(?<weekday>${LONG_WEEKDAYS.join("|")}), (?<day>[0-9]{2})-${MONTH}-(?<year>[0-9]{2}) ${TIME} GMT$`
  ),
  new RegExp(`^${WEEKDAY} ${MONTH} (?<day>[1-9][0-9]?) ${TIME} (?<year>[0-9]{4})$`)
];

/**
 * Read an HTTP-date as milliseconds since the epoch
 *
 * A two-digit RFC 850 year is read from 1970 to 2069, as PHP reads it. A date that would roll
 * over, such as 31 February or 24:00:00, or that names the wrong weekday, is refused, as the
 * Laravel transport refuses it.
 *
 * @param text - The header value, with runs of spaces already collapsed
 * @returns The time, or undefined when the text is not a valid HTTP-date
 */
const parseHttpDate = (text: string): number | undefined => {
  const fields = HTTP_DATE_PATTERNS.map(pattern => pattern.exec(text)?.groups).find(Boolean);
  if (!fields) {
    return undefined;
  }
  const day = Number(fields.day);
  const hours = Number(fields.hours);
  const minutes = Number(fields.minutes);
  const seconds = Number(fields.seconds);
  const shortYear = Number(fields.year);
  const year = fields.year?.length === 2 ? shortYear + (shortYear < 70 ? 2000 : 1900) : shortYear;
  const date = new Date(0);
  date.setUTCFullYear(year, MONTHS.indexOf(fields.month ?? ""), day);
  date.setUTCHours(hours, minutes, seconds);
  const exact =
    date.getUTCFullYear() === year &&
    MONTHS[date.getUTCMonth()] === fields.month &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hours &&
    date.getUTCMinutes() === minutes &&
    date.getUTCSeconds() === seconds &&
    [WEEKDAYS, LONG_WEEKDAYS].some(names => names[date.getUTCDay()] === fields.weekday);
  return exact ? date.getTime() : undefined;
};

/**
 * Read a `Retry-After` header as a number of seconds to wait
 *
 * Only spaces and tabs are trimmed, and a run of spaces counts as one, since asctime pads a
 * one-digit day with a space.
 *
 * @param value - The header value, if any
 * @param now - The current time, in milliseconds since the epoch
 * @returns The seconds to wait, 0 for a date in the past, or undefined when the header is absent,
 * is a number of seconds above `Number.MAX_SAFE_INTEGER`, or is neither a whole number of seconds
 * nor an HTTP-date
 */
const parseRetryAfter = (
  value: string | null | undefined,
  now: number = Date.now()
): number | undefined => {
  const text = (value ?? "").replace(/^[ \t]+|[ \t]+$/g, "");
  if (/^[0-9]+$/.test(text)) {
    const seconds = Number(text);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const date = parseHttpDate(text.replace(/ {2,}/g, " "));
  return date === undefined ? undefined : Math.max(0, Math.ceil((date - now) / 1000));
};

const toError = (response: Response, body: SendResult): BrudcastError =>
  new BrudcastError(
    nonEmptyString(body.message) ?? `Brudcast responded with HTTP ${response.status}`,
    response.status,
    body,
    { retryAfter: parseRetryAfter(response.headers.get("retry-after")) }
  );

/**
 * An empty message fails validation with a 422, which the service only returns once it has
 * accepted the key. Only the service's own validation response counts, so a 422 from a proxy in
 * front of it does not.
 */
const isValidationResponse = (response: Response, body: SendResult): boolean =>
  response.status === 422 && body.status === false && Array.isArray(body.errors);

const withCallback = <T>(promise: Promise<T>, callback?: Callback<T>): Promise<T> | undefined => {
  if (!callback) {
    return promise;
  }
  promise.then(
    result => callback(null, result),
    error => callback(error, undefined as T)
  );
  return undefined;
};

const createApiTransport = (options: BrudcastTransportOptions): BrudcastTransport => {
  const apiKey = resolveApiKey(options);
  if (!apiKey) {
    throw new TypeError(
      "nodemailer-brudcast-transport requires auth.apiKey (a Brudcast sending key) or auth.user and auth.pass (Brudcast SMTP credentials)"
    );
  }
  if (!API_KEY_PATTERN.test(apiKey)) {
    throw new TypeError("The Brudcast sending key contains characters that are not allowed.");
  }
  const resolved: ResolvedOptions = {
    apiKey,
    url: resolveSendUrl(
      options.url === undefined || options.url === null || options.url === ""
        ? DEFAULT_URL
        : options.url,
      isInsecure(options.insecure)
    ),
    timeout: resolveTimeout(options.timeout)
  };

  const deliver = async (mail: NormalizableMail): Promise<BrudcastSentMessageInfo> => {
    const data = await normalize(mail);
    const authors = mail.message?.getAddresses().from;
    if (authors && authors.length > 1) {
      data.from = authors;
    }
    const { response, body } = await post(resolved, await buildPayload(data));
    if (!response.ok || body.status === false) {
      throw toError(response, body);
    }
    const jobId = nonEmptyString(body.data?.jobId) ?? "";
    const envelope = data.envelope ?? { from: false, to: [] };
    return {
      envelope,
      messageId: jobId ? `<${jobId}@${MESSAGE_ID_DOMAIN}>` : "",
      jobId,
      accepted: [...envelope.to],
      rejected: [],
      pending: [],
      response: `${response.status} ${nonEmptyString(body.message) ?? "Accepted"}`
    };
  };

  const checkCredentials = async (): Promise<true> => {
    const { response, body } = await post(resolved, {});
    if (isValidationResponse(response, body)) {
      return true;
    }
    throw toError(response, body);
  };

  return {
    name: "Brudcast",
    version: packageVersion,
    options,
    send(mail, callback) {
      withCallback(deliver(mail), callback);
    },
    verify(callback?: Callback<true>) {
      return withCallback(checkCredentials(), callback);
    },
    isIdle: () => true,
    close: () => undefined
  } as BrudcastTransport;
};

/**
 * Create a Nodemailer transport that delivers through the Brudcast mailing service
 *
 * A sending key delivers over the HTTP API. SMTP credentials return options for Nodemailer's
 * built-in SMTP transport, preset for Brudcast's submission server.
 *
 * @param options - Either the sending key with an optional service URL, `insecure` flag and
 * request timeout, or the SMTP username and password with an optional host, port, timeout, pool
 * and TLS options
 * @returns A transport, or SMTP transport options, to pass to `nodemailer.createTransport`
 * @throws {TypeError} When no credentials are supplied, both kinds are, the sending key has a
 * character other than visible ASCII, the service URL is not valid or is not https and `insecure`
 * is not set, or the timeout is not a positive number within the range a timer supports
 */
export function brudcastTransport(options: BrudcastTransportOptions): BrudcastTransport;
export function brudcastTransport(options: BrudcastSmtpOptions): BrudcastSmtpTransportOptions;
export function brudcastTransport(
  options: BrudcastTransportOptions | BrudcastSmtpOptions
): BrudcastTransport | BrudcastSmtpTransportOptions {
  const resolved = options ?? {};
  if (!isSmtpOptions(resolved)) {
    return createApiTransport(resolved);
  }
  if (resolveApiKey(resolved as BrudcastTransportOptions)) {
    throw new TypeError(
      "nodemailer-brudcast-transport accepts a sending key or SMTP credentials, not both"
    );
  }
  return brudcastSmtp(resolved);
}

export { BrudcastError };
export type { BrudcastErrorOptions } from "./errors";
export { buildPayload } from "./payload";
export { brudcastSmtp, DEFAULT_SMTP_HOST, DEFAULT_SMTP_PORT, SMTP_PORTS } from "./smtp";
export type * from "./types";
export default brudcastTransport;
