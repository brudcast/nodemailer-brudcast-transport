import type { BrudcastSmtpOptions, BrudcastSmtpTransportOptions } from "./types";

export const DEFAULT_SMTP_HOST = "out-smtp.brudcast.com";
export const DEFAULT_SMTP_PORT = 587;
export const SMTP_PORTS = {
  starttls: [587, 2525, 25],
  implicitTls: [465]
} as const;

const isImplicitTls = (port: number): boolean =>
  (SMTP_PORTS.implicitTls as readonly number[]).includes(port);

/**
 * Build Nodemailer SMTP options for submitting to the Brudcast mailing service
 *
 * TLS is always required: port 465 negotiates it on connect, every other port must upgrade with
 * STARTTLS, so a server that stops advertising it fails the send instead of going plaintext.
 *
 * @param options - The SMTP username and password and, optionally, the host, port and timeouts
 * @returns An options object to pass to `nodemailer.createTransport`
 * @throws {TypeError} When the username or password is missing
 */
export function brudcastSmtp(options: BrudcastSmtpOptions): BrudcastSmtpTransportOptions {
  const { user, pass } = options?.auth ?? {};
  if (!user || !pass) {
    throw new TypeError(
      "nodemailer-brudcast-transport requires auth.user and auth.pass (Brudcast SMTP credentials)"
    );
  }
  const port = options.port ?? DEFAULT_SMTP_PORT;
  const secure = options.secure ?? isImplicitTls(port);
  const { timeout } = options;
  const result: BrudcastSmtpTransportOptions = {
    host: options.host ?? DEFAULT_SMTP_HOST,
    port,
    secure,
    requireTLS: !secure,
    auth: { user, pass },
    pool: options.pool,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
    tls: options.tls
  };
  return Object.fromEntries(
    Object.entries(result).filter(([, value]) => value !== undefined)
  ) as unknown as BrudcastSmtpTransportOptions;
}
