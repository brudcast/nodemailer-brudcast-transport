import consolidate from "@ladjs/consolidate";
import type {
  BrudcastAddress,
  BrudcastAttachment,
  BrudcastSendPayload,
  NormalizedMail,
  ParsedAddress,
  ResolvedAttachment,
  TemplateOptions
} from "./types";

const isTemplate = (value: unknown): value is TemplateOptions =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as TemplateOptions).name === "string" &&
  typeof (value as TemplateOptions).engine === "string";

const toAddress = (item: unknown): BrudcastAddress | undefined => {
  const { name, address } = (item ?? {}) as ParsedAddress;
  if (!address) {
    return undefined;
  }
  return name ? { name, address } : { address };
};

const toAddressList = (items: unknown): BrudcastAddress[] | undefined => {
  const addresses = ([] as unknown[])
    .concat(items ?? [])
    .map(toAddress)
    .filter((item): item is BrudcastAddress => item !== undefined);
  return addresses.length ? addresses : undefined;
};

/**
 * One address as an object, several as a list, which the Brudcast API accepts for From and
 * Reply-To alike
 */
const toAddressOrList = (items: unknown): BrudcastAddress | BrudcastAddress[] | undefined => {
  const addresses = toAddressList(items);
  return addresses && addresses.length > 1 ? addresses : addresses?.[0];
};

const toBase64 = (item: ResolvedAttachment): string => {
  if (Buffer.isBuffer(item.content)) {
    return item.content.toString("base64");
  }
  if (typeof item.content === "object" && item.content !== null) {
    throw new TypeError(
      `Attachment "${item.filename}" uses raw, which the Brudcast API does not support; use content, path or href, or send over SMTP`
    );
  }
  const content = String(item.content ?? "");
  if (item.encoding === "base64") {
    return content;
  }
  return Buffer.from(content, (item.encoding as BufferEncoding) || "utf8").toString("base64");
};

const CID_REFERENCE_PATTERN =
  /<(?:img\s+[^>]*src|\w+\s+[^>]*background)\s*=\s*(?:(['"])cid:(.+?)\1|cid:([^>\s]+))/gi;

/**
 * The `cid:` names in image sources and backgrounds, found the way the Laravel transport finds
 * them
 */
export const contentIdReferences = (html: string | undefined): Set<string> =>
  new Set(
    [...(html ?? "").matchAll(CID_REFERENCE_PATTERN)]
      .map(match => match[2] ?? match[3])
      .filter((reference): reference is string => Boolean(reference))
  );

/**
 * A content ID the mailing service accepts: up to 255 characters, no whitespace or angle brackets
 */
const CONTENT_ID_PATTERN = /^[^\s<>]{1,255}$/;

/**
 * An attachment the HTML references by its cid is sent with it, without the angle brackets
 * Nodemailer also accepts, so Brudcast delivers it inline and the `cid:` link resolves. One the
 * HTML does not reference, or with a cid the service would reject, is sent as a regular
 * attachment instead of failing the whole message.
 */
export const toAttachments = (
  attachments: ResolvedAttachment[] = [],
  references: Set<string> = new Set()
): BrudcastAttachment[] | undefined => {
  const result = attachments.filter(Boolean).map((item, index) => {
    const cid = item.cid?.replace(/[<>]/g, "");
    const inline = cid && references.has(cid) && CONTENT_ID_PATTERN.test(cid);
    return {
      filename: item.filename || cid || `attachment-${index + 1}`,
      content: toBase64(item),
      encoding: "base64" as const,
      contentType: item.contentType || "application/octet-stream",
      ...(inline ? { cid } : {})
    };
  });
  return result.length ? result : undefined;
};

/**
 * Numbers and booleans are written as text, as Nodemailer does over SMTP, which also skips a
 * value of 0 or false. Line breaks become spaces, so a value can never start a header of its own.
 */
const headerText = (value: unknown): string | undefined => {
  const text =
    typeof value === "object" && value !== null && "value" in value
      ? (value as { value: unknown }).value
      : value;
  if (typeof text === "number" || typeof text === "boolean") {
    return text ? String(text) : undefined;
  }
  if (typeof text !== "string") {
    return undefined;
  }
  return text.replace(/\r\n|\r|\n/g, " ").trim() || undefined;
};

/**
 * Headers the mailing service sets itself, or reads from the dedicated payload fields
 */
const RESERVED_HEADERS = new Set([
  "bcc",
  "cc",
  "content-transfer-encoding",
  "content-type",
  "date",
  "from",
  "message-id",
  "mime-version",
  "reply-to",
  "return-path",
  "sender",
  "subject",
  "to",
  "x-brudcast-job-id"
]);

/**
 * A header name is printable ASCII other than the colon (RFC 5322 section 3.6.8)
 */
const HEADER_NAME_PATTERN = /^[!-9;-~]+$/;

const customHeaderEntries = (headers: unknown): [unknown, unknown][] =>
  Array.isArray(headers)
    ? headers.map(item => [(item as { key?: unknown } | null)?.key, item])
    : Object.entries((headers ?? {}) as Record<string, unknown>).flatMap(([key, value]) =>
        ([] as unknown[]).concat(value).map((item): [unknown, unknown] => [key, item])
      );

/**
 * A name is checked even when its value is empty, as the Laravel transport does, so an invalid
 * header fails the same way whatever it holds
 */
const groupCustomHeaders = (headers: unknown): Map<string, { name: string; values: string[] }> => {
  const groups = new Map<string, { name: string; values: string[] }>();
  for (const [key, value] of customHeaderEntries(headers)) {
    if (typeof key !== "string" || key === "" || RESERVED_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    if (!HEADER_NAME_PATTERN.test(key)) {
      throw new TypeError(`The header name "${key}" is not valid`);
    }
    const text = headerText(value);
    if (text === undefined) {
      continue;
    }
    const group = groups.get(key.toLowerCase()) ?? { name: key, values: [] };
    group.values.push(text);
    groups.set(key.toLowerCase(), group);
  }
  return groups;
};

/**
 * The headers Nodemailer adds for `priority` over SMTP; a normal priority adds none
 */
const PRIORITY_HEADERS: Record<string, Record<string, string>> = {
  high: { "X-Priority": "1 (Highest)", "X-MSMail-Priority": "High", Importance: "High" },
  low: { "X-Priority": "5 (Lowest)", "X-MSMail-Priority": "Low", Importance: "Low" }
};

/**
 * Like Nodemailer over SMTP, the priority headers replace custom headers of the same name
 */
const withPriority = (
  headers: Record<string, string>,
  priority: unknown
): Record<string, string> => {
  const added = PRIORITY_HEADERS[String(priority ?? "").toLowerCase()];
  if (!added) {
    return headers;
  }
  const replaced = new Set(Object.keys(added).map(name => name.toLowerCase()));
  return {
    ...Object.fromEntries(
      Object.entries(headers).filter(([name]) => !replaced.has(name.toLowerCase()))
    ),
    ...added
  };
};

/**
 * Nodemailer's normalized headers keep only the first value of a repeated header and number the
 * headers given as a list, so custom headers are also read from the message itself, and repeated
 * ones are joined into one comma-separated value. Headers the mailing service owns are left out.
 */
export const toHeaders = (mail: NormalizedMail): Record<string, string> | undefined => {
  const groups = groupCustomHeaders(mail.headers);
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(mail.normalizedHeaders ?? {})) {
    const text = headerText(value);
    const numbered = Array.isArray(mail.headers) && /^\d+$/.test(key);
    const repeated = (groups.get(key.toLowerCase())?.values.length ?? 0) > 1;
    if (text !== undefined && !numbered && !repeated) {
      headers[key] = text;
    }
  }
  for (const { name, values } of groups.values()) {
    if (values.length > 1 || !Object.hasOwn(headers, name)) {
      headers[name] = values.join(", ");
    }
  }
  const allowed = Object.entries(withPriority(headers, mail.priority)).filter(
    ([name]) => !RESERVED_HEADERS.has(name.toLowerCase())
  );
  return allowed.length ? Object.fromEntries(allowed) : undefined;
};

export const renderHtml = async (mail: NormalizedMail): Promise<string | undefined> => {
  if (typeof mail.html === "string") {
    return mail.html;
  }
  if (!isTemplate(mail.template)) {
    return undefined;
  }
  const { engine, name, context = {} } = mail.template;
  const render = consolidate[engine];
  if (typeof render !== "function") {
    throw new Error(`Unsupported template engine "${engine}"`);
  }
  return render(name, context);
};

/**
 * With an envelope, its recipients decide who receives the message, as in the Laravel transport:
 * `to` is every envelope recipient that is not a Cc or Bcc, named as in the To header when it
 * appears there, since the envelope keeps only addresses
 */
const toRecipients = (mail: NormalizedMail): BrudcastAddress[] | undefined => {
  const to = toAddressList(mail.to);
  if (!mail.envelope) {
    return to;
  }
  const key = (address: string): string => address.toLowerCase();
  const copied = new Set(
    [...(toAddressList(mail.cc) ?? []), ...(toAddressList(mail.bcc) ?? [])].map(item =>
      key(item.address)
    )
  );
  const named = new Map<string, BrudcastAddress>();
  for (const item of to ?? []) {
    if (!named.has(key(item.address))) {
      named.set(key(item.address), item);
    }
  }
  const recipients = mail.envelope.to
    .filter(address => !copied.has(key(address)))
    .map(address => named.get(key(address)) ?? { address });
  return recipients.length ? recipients : undefined;
};

export const buildPayload = async (mail: NormalizedMail): Promise<BrudcastSendPayload> => {
  const html = await renderHtml(mail);
  const payload: Partial<BrudcastSendPayload> = {
    from: toAddressOrList(mail.from),
    to: toRecipients(mail),
    cc: toAddressList(mail.cc),
    bcc: toAddressList(mail.bcc),
    replyTo: toAddressOrList(mail.replyTo),
    subject: mail.subject,
    text: typeof mail.text === "string" ? mail.text : undefined,
    html,
    attachments: toAttachments(mail.attachments, contentIdReferences(html)),
    headers: toHeaders(mail)
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as unknown as BrudcastSendPayload;
};
