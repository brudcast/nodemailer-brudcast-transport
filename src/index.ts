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
 * The service matches the key exactly, and a secret store can leave a trailing newline
 */
const resolveApiKey = (options: BrudcastTransportOptions): string | undefined =>
  (options.auth?.apiKey || options.auth?.api_key || options.apiKey)?.trim() || undefined;

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
 * A redirect is not followed, since a redirected POST turns into a GET without its body, so it
 * fails with the target in the message. A 2xx without a JSON body, as a proxy in front of the
 * service may send, counts as sent: the message may be queued by then, and failing it would
 * send it again on retry.
 */
const parseBody = async (response: Response): Promise<SendResult> => {
  if (response.status >= 300 && response.status < 400) {
    return {
      status: false,
      message: `The Brudcast url redirected to "${response.headers.get("location") ?? ""}"; set url to the final URL`
    };
  }
  const text = await response.text();
  const body = text ? parseJson(text) : undefined;
  if (typeof body === "object" && body !== null) {
    return body as SendResult;
  }
  return response.ok || !text ? { status: response.ok } : { status: false, message: text };
};

/**
 * The send path is appended to any path the url already has, so the service can sit behind a
 * prefix. Every request carries the sending key, so plain http is refused unless the transport
 * opts in with `insecure`.
 */
const resolveSendUrl = (base: string, insecure: boolean): URL => {
  const url = new URL(base);
  if (!url.hostname || (url.protocol !== "https:" && !(url.protocol === "http:" && insecure))) {
    throw new TypeError(
      `nodemailer-brudcast-transport requires an https url, not "${base}"; set insecure to allow http`
    );
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${SEND_PATH}`;
  url.search = "";
  url.hash = "";
  return url;
};

const post = (options: ResolvedOptions, payload: unknown): Promise<Response> =>
  fetch(options.url, {
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

const toError = (response: Response, body: SendResult): BrudcastError =>
  new BrudcastError(
    body.message || `Brudcast responded with HTTP ${response.status}`,
    response.status,
    body
  );

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
  const resolved: ResolvedOptions = {
    apiKey,
    url: resolveSendUrl(options.url ?? DEFAULT_URL, options.insecure === true),
    timeout: options.timeout ?? DEFAULT_TIMEOUT
  };

  const deliver = async (mail: NormalizableMail): Promise<BrudcastSentMessageInfo> => {
    const data = await normalize(mail);
    const authors = mail.message?.getAddresses().from;
    if (authors && authors.length > 1) {
      data.from = authors;
    }
    const response = await post(resolved, await buildPayload(data));
    const body = await parseBody(response);
    if (!response.ok || body.status === false) {
      throw toError(response, body);
    }
    const jobId = body.data?.jobId ?? "";
    const envelope = data.envelope ?? { from: false, to: [] };
    return {
      envelope,
      messageId: jobId ? `<${jobId}@${MESSAGE_ID_DOMAIN}>` : "",
      jobId,
      accepted: [...envelope.to],
      rejected: [],
      pending: [],
      response: `${response.status} ${body.message ?? "Accepted"}`
    };
  };

  const checkCredentials = async (): Promise<true> => {
    const response = await post(resolved, {});
    if (response.status === 422) {
      return true;
    }
    throw toError(response, await parseBody(response));
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
 * @param options - Either the sending key with an optional service URL and request timeout, or
 * the SMTP username and password with an optional host, port and timeouts
 * @returns A transport, or SMTP transport options, to pass to `nodemailer.createTransport`
 * @throws {TypeError} When no credentials are supplied, or both kinds are
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
export { buildPayload } from "./payload";
export { brudcastSmtp, DEFAULT_SMTP_HOST, DEFAULT_SMTP_PORT, SMTP_PORTS } from "./smtp";
export type * from "./types";
export default brudcastTransport;
