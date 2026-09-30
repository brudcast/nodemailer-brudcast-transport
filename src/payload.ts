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

/**
 * Clean a display name the way Symfony Mime does: line breaks are removed, then the characters
 * PHP's `trim` strips by default
 *
 * @param name - The parsed display name
 * @returns The name, or undefined when it is blank or not a string
 */
const toName = (name: unknown): string | undefined =>
  typeof name === "string"
    ? name.replace(/[\r\n]/g, "").replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, "") || undefined
    : undefined;

const toAddress = (item: unknown): BrudcastAddress | undefined => {
  const { name, address } = (item ?? {}) as ParsedAddress;
  if (!address) {
    return undefined;
  }
  const cleaned = toName(name);
  return cleaned ? { name: cleaned, address } : { address };
};

/**
 * Replace each address group, such as `Team: a@example.com, b@example.com;`, with its members
 */
const flattenGroups = (items: unknown): unknown[] =>
  ([] as unknown[]).concat(items ?? []).flatMap(item => {
    const group = (item as ParsedAddress | null)?.group;
    return Array.isArray(group) ? flattenGroups(group) : [item];
  });

const toAddressList = (items: unknown): BrudcastAddress[] | undefined => {
  const addresses = flattenGroups(items)
    .map(toAddress)
    .filter((item): item is BrudcastAddress => item !== undefined);
  return addresses.length ? addresses : undefined;
};

/**
 * Keep the first of each address, compared case-insensitively
 */
const uniqueAddresses = (items: BrudcastAddress[] = []): BrudcastAddress[] => {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = item.address.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};

/**
 * Convert parsed addresses to one address, or to a list when there are several
 *
 * The Brudcast API accepts either shape for From and Reply-To.
 *
 * @param items - A parsed address, a list of them, or nothing
 * @returns The single address, the list when there is more than one, or undefined when none has
 * an address
 */
const toAddressOrList = (items: unknown): BrudcastAddress | BrudcastAddress[] | undefined => {
  const addresses = toAddressList(items);
  return addresses && addresses.length > 1 ? addresses : addresses?.[0];
};

/**
 * The encodings an attachment's text content may be given in, by lowercase name
 */
const ENCODINGS: Record<string, BufferEncoding> = {
  ascii: "ascii",
  "us-ascii": "ascii",
  utf8: "utf8",
  "utf-8": "utf8",
  base64: "base64",
  hex: "hex",
  binary: "latin1",
  latin1: "latin1"
};

/**
 * Read an attachment's `encoding` option, case-insensitively, falling back to UTF-8 for a name
 * that is not known
 */
const toEncoding = (encoding: unknown): BufferEncoding =>
  (typeof encoding === "string" && Object.hasOwn(ENCODINGS, encoding.toLowerCase())
    ? ENCODINGS[encoding.toLowerCase()]
    : undefined) ?? "utf8";

/**
 * Read binary content as a buffer: a Buffer, any other view of an ArrayBuffer such as a
 * Uint8Array, or an ArrayBuffer itself
 */
const toBuffer = (content: unknown): Buffer | undefined => {
  if (ArrayBuffer.isView(content)) {
    return Buffer.from(content.buffer, content.byteOffset, content.byteLength);
  }
  return content instanceof ArrayBuffer ? Buffer.from(content) : undefined;
};

/**
 * Encode an attachment's content as base64
 *
 * Binary content is sent as its bytes, and text in its `encoding`. Nodemailer leaves a `raw`
 * attachment as an object, and nests the whole attachment as its content when the content is
 * empty; any other object is not content the API can send.
 *
 * @param item - The resolved attachment
 * @param filename - The name the attachment is sent with, for the error message
 * @returns The base64 content
 * @throws {TypeError} When the attachment uses `raw`, its content is empty, or its content is an
 * object of another kind
 */
const toBase64 = (item: ResolvedAttachment, filename: string): string => {
  const { content } = item;
  const buffer = toBuffer(content);
  if (buffer === undefined && typeof content === "object" && content !== null) {
    if ("raw" in content) {
      throw new TypeError(
        `Attachment "${filename}" uses raw, which the Brudcast API does not support; use content, path or href, or send over SMTP`
      );
    }
    const nested = content as ResolvedAttachment;
    if (nested.filename === item.filename && !nested.content) {
      throw new TypeError(`The attachment "${filename}" is empty.`);
    }
    throw new TypeError(`The attachment "${filename}" has content of an unsupported type.`);
  }
  const encoding = toEncoding(item.encoding);
  const encoded = buffer
    ? buffer.toString("base64")
    : encoding === "base64"
      ? String(content ?? "")
      : Buffer.from(String(content ?? ""), encoding).toString("base64");
  if (!encoded) {
    throw new TypeError(`The attachment "${filename}" is empty.`);
  }
  return encoded;
};

const DEFAULT_CONTENT_TYPE = "application/octet-stream";

/**
 * The first extension Nodemailer gives the common content types, for naming an attachment
 * without a filename. This is Nodemailer's table, so for some types the extension differs from
 * the one the Laravel transport takes from Symfony's MIME types.
 */
const EXTENSIONS: Record<string, string> = {
  "application/json": "json",
  "application/msword": "doc",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/xml": "xml",
  "application/zip": "zip",
  "audio/mpeg": "mpga",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/tiff": "tif",
  "image/webp": "webp",
  "text/calendar": "ics",
  "text/css": "css",
  "text/csv": "csv",
  "text/html": "html",
  "text/xml": "xml",
  "video/mp4": "mp4"
};

const extensionFor = (contentType: string): string => {
  const type = contentType.toLowerCase().trim();
  return EXTENSIONS[type] ?? (type.startsWith("text/") ? "txt" : "bin");
};

/**
 * The longest attribute run between a tag name and a `src` or `background` attribute, and the
 * longest content ID, that a cid reference is looked for in, both in UTF-8 bytes. 765 bytes is the
 * most that 255 UTF-16 code units, the longest content ID the service accepts, take in UTF-8.
 */
const MAX_ATTRIBUTE_RUN = 4000;
const MAX_REFERENCE_BYTES = 765;

/**
 * Whether a byte is whitespace as PCRE's `\s` defines it without the `u` flag: space, tab, line
 * feed, vertical tab, form feed and carriage return
 */
const isSpace = (code: number): boolean => (code >= 0x09 && code <= 0x0d) || code === 0x20;

/**
 * Whether a byte ends a line, which PCRE's `.` does not match: only a line feed
 */
const isLineTerminator = (code: number): boolean => code === 0x0a;

/**
 * Whether a byte is a word character as PCRE's `\w` defines it without the `u` flag
 */
const isWordCharacter = (code: number): boolean =>
  (code >= 0x30 && code <= 0x39) ||
  (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) ||
  code === 0x5f;

/**
 * Whether the text at a position is the given lowercase word, ignoring the case of ASCII letters
 * only, as a case-insensitive RegExp without the `u` flag does
 */
const hasWordAt = (html: string, at: number, word: string): boolean => {
  for (let offset = 0; offset < word.length; offset++) {
    const code = html.charCodeAt(at + offset);
    const expected = word.charCodeAt(offset);
    if (code !== expected && !(expected >= 0x61 && expected <= 0x7a && code === expected - 0x20)) {
      return false;
    }
  }
  return true;
};

const skipSpaces = (html: string, from: number): number => {
  let at = from;
  while (at < html.length && isSpace(html.charCodeAt(at))) {
    at++;
  }
  return at;
};

interface Reference {
  cid: string;
  end: number;
}

/**
 * Read the `=` and the `cid:` value after an attribute name: quoted, the shortest run of 1 to
 * 765 bytes without a line feed up to the same quote, or unquoted, 1 to 765 bytes other than
 * whitespace and `>`, followed by whitespace, `>` or the end
 *
 * @param html - The HTML as bytes, one character per byte
 * @param from - The position just after the attribute name
 * @returns The content ID and the position after the reference, or undefined when there is none
 */
const readReference = (html: string, from: number): Reference | undefined => {
  const equals = skipSpaces(html, from);
  if (html.charCodeAt(equals) !== 0x3d) {
    return undefined;
  }
  const value = skipSpaces(html, equals + 1);
  const quote = html[value];
  if (quote === '"' || quote === "'") {
    if (!hasWordAt(html, value + 1, "cid:")) {
      return undefined;
    }
    const start = value + 5;
    for (let length = 1; length <= MAX_REFERENCE_BYTES && start + length < html.length; length++) {
      if (isLineTerminator(html.charCodeAt(start + length - 1))) {
        return undefined;
      }
      if (html[start + length] === quote) {
        return { cid: html.slice(start, start + length), end: start + length + 1 };
      }
    }
    return undefined;
  }
  if (!hasWordAt(html, value, "cid:")) {
    return undefined;
  }
  const start = value + 4;
  let end = start;
  while (
    end < html.length &&
    end - start <= MAX_REFERENCE_BYTES &&
    html[end] !== ">" &&
    !isSpace(html.charCodeAt(end))
  ) {
    end++;
  }
  return end > start && end - start <= MAX_REFERENCE_BYTES
    ? { cid: html.slice(start, end), end }
    : undefined;
};

/**
 * The positions of an attribute name that is followed by a cid reference, in order, with the
 * reference each one reads
 */
const attributeReferences = (html: string, name: string) => {
  const positions: number[] = [];
  const references: Reference[] = [];
  const pattern = new RegExp(name, "gi");
  for (const match of html.matchAll(pattern)) {
    const reference = readReference(html, match.index + name.length);
    if (reference) {
      positions.push(match.index);
      references.push(reference);
    }
  }
  return { positions, references };
};

const utf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * Decode bytes held one per character, or undefined when they are not valid UTF-8
 */
const toUtf8 = (bytes: string): string | undefined => {
  try {
    return utf8.decode(Buffer.from(bytes, "latin1"));
  } catch {
    return undefined;
  }
};

/**
 * Collect the `cid:` names the HTML references in image sources and backgrounds
 *
 * The result is what this pattern, which the Laravel transport also uses, matches in PHP, where
 * it runs over the UTF-8 bytes without the `u` flag: `\s` is ASCII whitespace, `.` is any byte but
 * a line feed, and the lengths count bytes.
 *
 * ```
 * /<(?:img\s+[^>]{0,4000}src|\w+\s+[^>]{0,4000}background)\s*=\s*
 *   (?:(['"])cid:(.{1,765}?)\1|cid:([^>\s]{1,765}+)(?=[>\s]|$))/i
 * ```
 *
 * So the HTML is scanned as its UTF-8 bytes too, and a reference that is not valid UTF-8 is
 * dropped, as the Laravel transport drops it. A reference longer than the service accepts is
 * still read, so it hides an earlier one in the same tag, and its attachment is then sent as a
 * regular one.
 *
 * A regular expression engine backtracks through every attribute run in turn, which takes
 * seconds on hostile HTML such as many unclosed tags. The same matches are found here in linear
 * time instead: the `src` and `background` attributes followed by a reference are listed once,
 * and each `<` then takes the last of them within reach of its tag name, as the greedy attribute
 * run does.
 *
 * @param html - The rendered HTML body, if any
 * @returns The referenced content IDs, empty when there is no HTML
 */
export const contentIdReferences = (html: string | undefined): Set<string> => {
  const found = new Set<string>();
  if (!/cid:/i.test(html ?? "")) {
    return found;
  }
  const text = Buffer.from(html ?? "", "utf8").toString("latin1");
  const sources = attributeReferences(text, "src");
  const backgrounds = attributeReferences(text, "background");
  let closing = { from: -1, at: -1 };
  const nextClosing = (from: number): number => {
    if (from < closing.from || from > closing.at) {
      const at = text.indexOf(">", from);
      closing = { from, at: at === -1 ? text.length : at };
    }
    return closing.at;
  };
  /**
   * Find the reference of the attribute that starts last between one character after the tag
   * name and the end of the attribute run, before any `>`
   */
  const lastWithinRun = (
    { positions, references }: ReturnType<typeof attributeReferences>,
    nameEnd: number
  ): Reference | undefined => {
    const limit = Math.min(skipSpaces(text, nameEnd) + MAX_ATTRIBUTE_RUN, nextClosing(nameEnd) - 1);
    let low = 0;
    let high = positions.length - 1;
    let index = -1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      if ((positions[middle] as number) <= limit) {
        index = middle;
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }
    return index !== -1 && (positions[index] as number) > nameEnd ? references[index] : undefined;
  };
  let from = 0;
  for (let open = text.indexOf("<", from); open !== -1; open = text.indexOf("<", from)) {
    let reference: Reference | undefined;
    if (hasWordAt(text, open + 1, "img") && isSpace(text.charCodeAt(open + 4))) {
      reference = lastWithinRun(sources, open + 4);
    }
    if (!reference) {
      let nameEnd = open + 1;
      while (nameEnd < text.length && isWordCharacter(text.charCodeAt(nameEnd))) {
        nameEnd++;
      }
      if (nameEnd > open + 1 && isSpace(text.charCodeAt(nameEnd))) {
        reference = lastWithinRun(backgrounds, nameEnd);
      }
    }
    const cid = reference && toUtf8(reference.cid);
    if (cid !== undefined) {
      found.add(cid);
    }
    from = reference ? reference.end : open + 1;
  }
  return found;
};

/**
 * A content ID the mailing service accepts: 1 to 255 UTF-16 code units, none of them whitespace
 * or an angle bracket. Without the `u` flag each code unit is matched on its own.
 */
const CONTENT_ID_PATTERN = /^[^\s<>]{1,255}$/;

/**
 * Convert Nodemailer's resolved attachments to Brudcast attachments with base64 content
 *
 * An attachment the HTML references by its cid keeps the cid, without the angle brackets
 * Nodemailer also accepts, so Brudcast delivers it inline and the `cid:` link resolves. One the
 * HTML does not reference, or whose cid is not 1 to 255 UTF-16 code units free of whitespace and
 * angle brackets as the mailing service requires, is sent as a regular attachment instead of
 * failing the whole message. One without a filename is named `attachment-<n>.<ext>` from its
 * position and content type, as Nodemailer names it, which for some types gives a different
 * extension than the Laravel transport does.
 *
 * @param attachments - The resolved attachments from the normalized message
 * @param references - The content IDs the HTML references
 * @returns The converted attachments, or undefined when there are none
 * @throws {TypeError} When an attachment uses `raw`, which the Brudcast API does not support, its
 * content is empty, or its content is an object of an unsupported kind
 */
export const toAttachments = (
  attachments: ResolvedAttachment[] = [],
  references: Set<string> = new Set()
): BrudcastAttachment[] | undefined => {
  const result = attachments.flatMap((item, index) => {
    if (!item) {
      return [];
    }
    const cid = item.cid?.replace(/[<>]/g, "");
    const inline = cid && references.has(cid) && CONTENT_ID_PATTERN.test(cid);
    const contentType = item.contentType || DEFAULT_CONTENT_TYPE;
    const filename =
      typeof item.filename === "string" && item.filename !== ""
        ? item.filename
        : `attachment-${index + 1}.${extensionFor(contentType)}`;
    return {
      filename,
      content: toBase64(item, filename),
      encoding: "base64" as const,
      contentType,
      ...(inline ? { cid } : {})
    };
  });
  return result.length ? result : undefined;
};

/**
 * Read a header value as single-line text
 *
 * A `{ value }` object is unwrapped. Numbers and booleans are written as text, as Nodemailer does
 * over SMTP, which also skips a value of 0 or false. Line breaks become spaces, so a value can
 * never start a header of its own, and spaces and tabs are trimmed from both ends.
 *
 * @param value - A header value as given to Nodemailer
 * @returns The trimmed text, or undefined when the value is empty or of another type
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
  return text.replace(/\r\n|\r|\n/g, " ").replace(/^[ \t]+|[ \t]+$/g, "") || undefined;
};

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

const HEADER_NAME_PATTERN = /^[!-9;-~]+$/;

/**
 * Check a header name against RFC 5322 section 3.6.8, printable ASCII other than the colon
 *
 * @throws {TypeError} When the name is not valid
 */
const assertHeaderName = (name: string): void => {
  if (!HEADER_NAME_PATTERN.test(name)) {
    throw new TypeError(`The header name "${name}" is not valid`);
  }
};

const customHeaderEntries = (headers: unknown): [unknown, unknown][] =>
  Array.isArray(headers)
    ? headers.map(item => [(item as { key?: unknown } | null)?.key, item])
    : Object.entries((headers ?? {}) as Record<string, unknown>).flatMap(([key, value]) =>
        ([] as unknown[]).concat(value).map((item): [unknown, unknown] => [key, item])
      );

/**
 * Group the custom headers by case-insensitive name, keeping every value in order
 *
 * Headers in `RESERVED_HEADERS` are skipped. A name is checked against RFC 5322 section 3.6.8,
 * printable ASCII other than the colon, even when its value is empty, as the Laravel transport
 * does, so an invalid header fails the same way whatever it holds.
 *
 * @param headers - The custom headers as given to Nodemailer, as an object or a list
 * @returns The groups keyed by lowercase name, each with the first spelling of the name
 * @throws {TypeError} When a header name is not valid
 */
const groupCustomHeaders = (headers: unknown): Map<string, { name: string; values: string[] }> => {
  const groups = new Map<string, { name: string; values: string[] }>();
  for (const [key, value] of customHeaderEntries(headers)) {
    if (typeof key !== "string" || key === "" || RESERVED_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    assertHeaderName(key);
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

const PRIORITY_HEADERS: Record<string, Record<string, string>> = {
  high: { "X-Priority": "1 (Highest)", "X-MSMail-Priority": "High", Importance: "High" },
  low: { "X-Priority": "5 (Lowest)", "X-MSMail-Priority": "Low", Importance: "Low" }
};

/**
 * Headers joined with a space when repeated, since they hold a list of message IDs
 */
const SPACE_SEPARATED_HEADERS = new Set(["in-reply-to", "references"]);

/**
 * Write a list of message IDs the way Nodemailer encodes References: each ID, split on
 * whitespace and angle brackets, in angle brackets, separated by a space
 *
 * @param value - The header value
 * @returns The IDs, or undefined when there are none
 */
const toMessageIds = (value: string): string | undefined =>
  value
    .split(/[\s<>]+/)
    .filter(Boolean)
    .map(id => `<${id}>`)
    .join(" ") || undefined;

/**
 * List the headers Nodemailer builds from message options over SMTP, in the order it adds them
 *
 * `inReplyTo`, `references` and `list` are read from the values Nodemailer has already encoded
 * into the normalized headers. `xMailer` adds X-Mailer only when set, as Nodemailer sends no
 * X-Mailer by default. A `priority` of `high` or `low` adds the priority headers; a normal or
 * unknown priority adds none. A `list` key must make a valid header name, as a custom header
 * name must.
 *
 * @param mail - The normalized message
 * @returns The headers as name and value pairs
 * @throws {TypeError} When a `list` key does not make a valid header name
 */
const optionHeaders = (mail: NormalizedMail): [string, string | undefined][] => {
  const normalized = (mail.normalizedHeaders ?? {}) as Record<string, unknown>;
  const list =
    typeof mail.list === "object" && mail.list !== null
      ? Object.keys(mail.list).map(key => `list-${key.toLowerCase().trim()}`)
      : [];
  list.forEach(assertHeaderName);
  return [
    ...(mail.inReplyTo ? [["in-reply-to", headerText(normalized["in-reply-to"])]] : []),
    ...(mail.references ? [["references", headerText(normalized.references)]] : []),
    ...(mail.xMailer ? [["X-Mailer", headerText(mail.xMailer)]] : []),
    ...Object.entries(PRIORITY_HEADERS[String(mail.priority ?? "").toLowerCase()] ?? {}),
    ...list.map(name => [name, headerText(normalized[name])])
  ] as [string, string | undefined][];
};

/**
 * Build the custom headers for the payload
 *
 * Nodemailer's normalized headers keep only the first value of a repeated header and number the
 * headers given as a list, so custom headers are read from the message itself. Names are merged
 * case-insensitively, keeping the first spelling and position, and repeated values are joined
 * with a comma, or a space for In-Reply-To and References. The headers Nodemailer builds from
 * message options then replace a custom header of the same name, in its place and spelling, as
 * they do over SMTP. In-Reply-To and References are written as a list of message IDs in angle
 * brackets, however they were given, as Nodemailer writes References. Headers the mailing
 * service sets itself, or reads from the dedicated payload fields, are left out.
 *
 * @param mail - The normalized message
 * @returns The headers by name, or undefined when there are none
 * @throws {TypeError} When a custom header name, or one made from a `list` key, is not valid
 */
export const toHeaders = (mail: NormalizedMail): Record<string, string> | undefined => {
  const normalized: Record<string, unknown> = Array.isArray(mail.headers)
    ? {}
    : (mail.normalizedHeaders ?? {});
  const headers = new Map<string, { name: string; value: string }>();
  for (const [key, { name, values }] of groupCustomHeaders(mail.headers)) {
    const value =
      values.length > 1
        ? values.join(SPACE_SEPARATED_HEADERS.has(key) ? " " : ", ")
        : (headerText(normalized[name]) ?? values.join(""));
    headers.set(key, { name, value });
  }
  for (const [name, value] of optionHeaders(mail)) {
    if (value !== undefined) {
      const key = name.toLowerCase();
      headers.set(key, { name: headers.get(key)?.name ?? name, value });
    }
  }
  for (const key of SPACE_SEPARATED_HEADERS) {
    const header = headers.get(key);
    if (header) {
      const value = toMessageIds(header.value);
      if (value === undefined) {
        headers.delete(key);
      } else {
        header.value = value;
      }
    }
  }
  return headers.size
    ? Object.fromEntries([...headers.values()].map(({ name, value }) => [name, value]))
    : undefined;
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
 * Resolve the To, Cc and Bcc recipients, from the envelope when the message has one
 *
 * As in the Laravel transport, the envelope decides who receives the message, since it keeps
 * only addresses and the headers keep the names. `to` is every envelope recipient in the To
 * header, named as there, then every envelope recipient in none of To, Cc and Bcc, in envelope
 * order; a recipient in To and also in Cc or Bcc stays in `to`. `cc` and `bcc` are the Cc and
 * Bcc addresses that are envelope recipients. Without an envelope each list comes straight from
 * its header. Each list keeps the first of each address, compared case-insensitively.
 *
 * @param mail - The normalized message
 * @returns The recipients, each list undefined when it is empty
 */
const toRecipients = (
  mail: NormalizedMail
): Pick<BrudcastSendPayload, "cc" | "bcc"> & { to?: BrudcastAddress[] } => {
  const nonEmpty = (items: BrudcastAddress[]) => (items.length ? items : undefined);
  const to = uniqueAddresses(toAddressList(mail.to));
  const cc = uniqueAddresses(toAddressList(mail.cc));
  const bcc = uniqueAddresses(toAddressList(mail.bcc));
  if (!mail.envelope) {
    return { to: nonEmpty(to), cc: nonEmpty(cc), bcc: nonEmpty(bcc) };
  }
  const key = (address: string): string => address.toLowerCase();
  const recipients = new Set(mail.envelope.to.map(key));
  const named = new Map(to.map(item => [key(item.address), item]));
  const listed = new Set([...to, ...cc, ...bcc].map(item => key(item.address)));
  const isRecipient = (item: BrudcastAddress) => recipients.has(key(item.address));
  return {
    to: nonEmpty(
      uniqueAddresses(
        mail.envelope.to
          .filter(address => named.has(key(address)) || !listed.has(key(address)))
          .map(address => named.get(key(address)) ?? { address })
      )
    ),
    cc: nonEmpty(cc.filter(isRecipient)),
    bcc: nonEmpty(bcc.filter(isRecipient))
  };
};

export const buildPayload = async (mail: NormalizedMail): Promise<BrudcastSendPayload> => {
  const html = await renderHtml(mail);
  const payload: Partial<BrudcastSendPayload> = {
    from: toAddressOrList(mail.from),
    ...toRecipients(mail),
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
