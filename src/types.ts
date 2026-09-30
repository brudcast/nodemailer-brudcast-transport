import type { ConnectionOptions } from "node:tls";

export interface BrudcastTransportOptions {
  auth?: {
    apiKey?: string;
    api_key?: string;
  };
  apiKey?: string;
  url?: string | null;
  insecure?: boolean | number | string;
  timeout?: number | string | null;
}

export interface BrudcastSmtpOptions {
  auth: {
    user: string;
    pass: string;
  };
  host?: string;
  port?: number;
  secure?: boolean;
  pool?: boolean;
  timeout?: number;
  tls?: ConnectionOptions;
}

export interface BrudcastSmtpTransportOptions {
  host: string;
  port: number;
  secure: boolean;
  requireTLS: boolean;
  auth: {
    user: string;
    pass: string;
  };
  pool?: boolean;
  connectionTimeout?: number;
  greetingTimeout?: number;
  socketTimeout?: number;
  tls?: ConnectionOptions;
}

export interface BrudcastAddress {
  name?: string;
  address: string;
}

export interface BrudcastAttachment {
  filename: string;
  content: string;
  encoding: "base64";
  contentType: string;
  cid?: string;
}

export interface BrudcastSendPayload {
  from: BrudcastAddress | BrudcastAddress[];
  to: BrudcastAddress[];
  cc?: BrudcastAddress[];
  bcc?: BrudcastAddress[];
  replyTo?: BrudcastAddress | BrudcastAddress[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: BrudcastAttachment[];
  headers?: Record<string, string>;
}

export interface BrudcastValidationIssue {
  path: (string | number)[];
  message: string;
  [key: string]: unknown;
}

export interface BrudcastResponse<T = unknown> {
  status: boolean;
  message?: string;
  data?: T;
  errors?: BrudcastValidationIssue[];
}

export interface BrudcastSentMessageInfo {
  envelope: Envelope;
  messageId: string;
  jobId: string;
  accepted: string[];
  rejected: string[];
  pending: string[];
  response: string;
}

export interface TemplateOptions {
  name: string;
  engine: string;
  context?: Record<string, unknown>;
}

/**
 * The message fields the transport reads on top of Nodemailer's own, for use as
 * `SendMailOptions & BrudcastSendMailOptions`
 */
export interface BrudcastSendMailOptions {
  template?: TemplateOptions;
}

export interface Envelope {
  from: string | false;
  to: string[];
}

export interface ParsedAddress {
  name?: string;
  address?: string;
  group?: ParsedAddress[];
}

export interface ResolvedAttachment {
  filename?: string | false;
  cid?: string;
  content?: unknown;
  encoding?: string;
  contentType?: string;
}

export interface NormalizedMail {
  envelope?: Envelope;
  from?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  replyTo?: unknown;
  subject?: string;
  text?: unknown;
  html?: unknown;
  template?: unknown;
  priority?: unknown;
  xMailer?: unknown;
  inReplyTo?: unknown;
  references?: unknown;
  list?: unknown;
  attachments?: ResolvedAttachment[];
  headers?: unknown;
  normalizedHeaders?: Record<string, string>;
}

export interface NormalizableMail {
  normalize(callback: (error: Error | null, data: NormalizedMail) => void): void;
  message?: {
    getAddresses(): { from?: ParsedAddress[] };
  };
}
