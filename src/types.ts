export interface BrudcastTransportOptions {
  auth?: {
    apiKey?: string;
    api_key?: string;
  };
  apiKey?: string;
  url?: string;
  timeout?: number;
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
}

export interface BrudcastSendPayload {
  from: BrudcastAddress;
  to: BrudcastAddress[];
  cc?: BrudcastAddress[];
  bcc?: BrudcastAddress[];
  replyTo?: { address: string };
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

export interface Envelope {
  from: string | false;
  to: string[];
}

export interface ParsedAddress {
  name?: string;
  address?: string;
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
  attachments?: ResolvedAttachment[];
  normalizedHeaders?: Record<string, string>;
}

export interface NormalizableMail {
  normalize(callback: (error: Error | null, data: NormalizedMail) => void): void;
}
