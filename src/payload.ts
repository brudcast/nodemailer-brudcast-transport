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

const toBase64 = (item: ResolvedAttachment): string => {
  if (Buffer.isBuffer(item.content)) {
    return item.content.toString("base64");
  }
  const content = String(item.content ?? "");
  if (item.encoding === "base64") {
    return content;
  }
  return Buffer.from(content, (item.encoding as BufferEncoding) || "utf8").toString("base64");
};

/**
 * An attachment with a cid is sent with it, without the angle brackets Nodemailer also accepts,
 * so Brudcast delivers it inline for the HTML's `cid:` reference
 */
export const toAttachments = (
  attachments: ResolvedAttachment[] = []
): BrudcastAttachment[] | undefined => {
  const result = attachments.filter(Boolean).map((item, index) => {
    const cid = item.cid?.replace(/[<>]/g, "");
    return {
      filename: item.filename || cid || `attachment-${index + 1}`,
      content: toBase64(item),
      encoding: "base64" as const,
      contentType: item.contentType || "application/octet-stream",
      ...(cid ? { cid } : {})
    };
  });
  return result.length ? result : undefined;
};

const headerText = (value: unknown): string | undefined => {
  const text =
    typeof value === "object" && value !== null && "value" in value
      ? (value as { value: unknown }).value
      : value;
  return typeof text === "string" && text.length > 0 ? text : undefined;
};

const customHeaderEntries = (headers: unknown): [unknown, unknown][] =>
  Array.isArray(headers)
    ? headers.map(item => [(item as { key?: unknown } | null)?.key, item])
    : Object.entries((headers ?? {}) as Record<string, unknown>).flatMap(([key, value]) =>
        ([] as unknown[]).concat(value).map((item): [unknown, unknown] => [key, item])
      );

const groupCustomHeaders = (headers: unknown): Map<string, { name: string; values: string[] }> => {
  const groups = new Map<string, { name: string; values: string[] }>();
  for (const [key, value] of customHeaderEntries(headers)) {
    const text = headerText(value);
    if (typeof key !== "string" || key === "" || text === undefined) {
      continue;
    }
    const group = groups.get(key.toLowerCase()) ?? { name: key, values: [] };
    group.values.push(text);
    groups.set(key.toLowerCase(), group);
  }
  return groups;
};

/**
 * Nodemailer's normalized headers keep only the first value of a repeated header and number the
 * headers given as a list, so custom headers are also read from the message itself, and repeated
 * ones are joined into one comma-separated value
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
  return Object.keys(headers).length ? headers : undefined;
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

export const buildPayload = async (mail: NormalizedMail): Promise<BrudcastSendPayload> => {
  const replyTo = toAddressList(mail.replyTo)?.[0];
  const payload: Partial<BrudcastSendPayload> = {
    from: toAddress(mail.from),
    to: toAddressList(mail.to),
    cc: toAddressList(mail.cc),
    bcc: toAddressList(mail.bcc),
    replyTo: replyTo ? { address: replyTo.address } : undefined,
    subject: mail.subject,
    text: typeof mail.text === "string" ? mail.text : undefined,
    html: await renderHtml(mail),
    attachments: toAttachments(mail.attachments),
    headers: toHeaders(mail)
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as unknown as BrudcastSendPayload;
};
