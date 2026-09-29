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

export const toAttachments = (
  attachments: ResolvedAttachment[] = []
): BrudcastAttachment[] | undefined => {
  const result = attachments.filter(Boolean).map((item, index) => ({
    filename: item.filename || item.cid || `attachment-${index + 1}`,
    content: toBase64(item),
    encoding: "base64" as const,
    contentType: item.contentType || "application/octet-stream"
  }));
  return result.length ? result : undefined;
};

const toHeaders = (headers: Record<string, string> = {}): Record<string, string> | undefined => {
  const entries = Object.entries(headers).filter(
    ([, value]) => typeof value === "string" && value.length > 0
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
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
    headers: toHeaders(mail.normalizedHeaders)
  };
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  ) as unknown as BrudcastSendPayload;
};
