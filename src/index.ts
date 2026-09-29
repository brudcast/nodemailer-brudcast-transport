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
  url: string;
  timeout: number;
}

type SendResult = BrudcastResponse<{ jobId: string }>;

const resolveApiKey = (options: BrudcastTransportOptions): string | undefined =>
  options.auth?.apiKey || options.auth?.api_key || options.apiKey;

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

const parseBody = async (response: Response): Promise<SendResult> => {
  const text = await response.text();
  try {
    return text ? (JSON.parse(text) as SendResult) : { status: response.ok };
  } catch {
    return { status: false, message: text };
  }
};

const post = (options: ResolvedOptions, payload: unknown): Promise<Response> =>
  fetch(new URL(SEND_PATH, options.url), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${options.apiKey}`,
      "User-Agent": `${packageName}/${packageVersion}`
    },
    body: JSON.stringify(payload),
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
    url: options.url ?? DEFAULT_URL,
    timeout: options.timeout ?? DEFAULT_TIMEOUT
  };

  const deliver = async (mail: NormalizableMail): Promise<BrudcastSentMessageInfo> => {
    const data = await normalize(mail);
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
