import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildPayload,
  contentIdReferences,
  renderHtml,
  toAttachments,
  toHeaders
} from "../src/payload";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("buildPayload", () => {
  it("drops fields that have no value", async () => {
    const payload = await buildPayload({
      from: { name: "", address: "a@example.com" },
      to: [{ address: "b@example.com" }],
      cc: [],
      bcc: [{ name: "Nobody" }],
      replyTo: null,
      subject: "Hello",
      text: { content: "not resolved" },
      attachments: [],
      normalizedHeaders: { "x-empty": "" }
    });

    expect(payload).toEqual({
      from: { address: "a@example.com" },
      to: [{ address: "b@example.com" }],
      subject: "Hello"
    });
  });

  it("sends one reply-to address as an object and several as a list", async () => {
    const payload = await buildPayload({
      from: { address: "a@example.com" },
      to: { address: "b@example.com" },
      replyTo: [
        { name: "Support", address: "support@example.com" },
        { address: "other@example.com" }
      ],
      subject: "s",
      text: "t"
    });

    expect(payload.to).toEqual([{ address: "b@example.com" }]);
    expect(payload.replyTo).toEqual([
      { name: "Support", address: "support@example.com" },
      { address: "other@example.com" }
    ]);

    const single = await buildPayload({
      from: { address: "a@example.com" },
      to: { address: "b@example.com" },
      replyTo: [{ name: "Support", address: "support@example.com" }],
      subject: "s",
      text: "t"
    });

    expect(single.replyTo).toEqual({ name: "Support", address: "support@example.com" });
  });
  it("cleans display names and leaves out a blank one", async () => {
    const payload = await buildPayload({
      from: { name: " \t\0Sales\x0B\r\n", address: "sales@example.com" },
      to: [
        { name: "Ma\r\nry", address: "mary@example.com" },
        { name: " \n ", address: "john@example.com" },
        { name: "\u00a0Ann\u00a0", address: "ann@example.com" }
      ],
      replyTo: { name: 42, address: "support@example.com" },
      subject: "s",
      text: "t"
    });

    expect(payload).toMatchObject({
      from: { name: "Sales", address: "sales@example.com" },
      to: [
        { name: "Mary", address: "mary@example.com" },
        { address: "john@example.com" },
        { name: "\u00a0Ann\u00a0", address: "ann@example.com" }
      ],
      replyTo: { address: "support@example.com" }
    });
  });

  it("flattens nested address groups in every field", async () => {
    const payload = await buildPayload({
      from: { name: "Team", group: [{ name: "Ann", address: "ann@example.com" }] },
      to: [{ name: "Outer", group: [{ name: "Inner", group: [{ address: "b@example.com" }] }] }],
      replyTo: [{ name: "Help", group: [] }, { address: "help@example.com" }],
      subject: "s",
      text: "t"
    });

    expect(payload).toMatchObject({
      from: { name: "Ann", address: "ann@example.com" },
      to: [{ address: "b@example.com" }],
      replyTo: { address: "help@example.com" }
    });
  });

  it("dedupes recipients without an envelope", async () => {
    const payload = await buildPayload({
      from: { address: "a@example.com" },
      to: [{ address: "b@example.com" }, { name: "B", address: "B@EXAMPLE.COM" }],
      bcc: [{ address: "c@example.com" }, { address: "C@example.com" }],
      subject: "s",
      text: "t"
    });

    expect(payload).toMatchObject({
      to: [{ address: "b@example.com" }],
      bcc: [{ address: "c@example.com" }]
    });
  });

  it("filters Cc and Bcc by an envelope with none of them", async () => {
    const payload = await buildPayload({
      envelope: { from: "a@example.com", to: [] },
      from: { address: "a@example.com" },
      to: [{ address: "b@example.com" }],
      cc: [{ address: "c@example.com" }],
      subject: "s",
      text: "t"
    });

    expect(payload).not.toHaveProperty("to");
    expect(payload).not.toHaveProperty("cc");
  });
});

describe("toHeaders", () => {
  it("skips headers without a name or a value", () => {
    expect(
      toHeaders({
        headers: [
          { key: "", value: "x" },
          { value: "no name" },
          null,
          { key: "X-Empty", value: "" }
        ]
      })
    ).toBeUndefined();
  });

  it("writes numbers and booleans as text, skipping 0 and false", () => {
    expect(
      toHeaders({
        headers: { "X-Count": 5, "X-Flag": true, "X-Zero": 0, "X-Off": false },
        normalizedHeaders: { "X-Count": 5, "X-Flag": true } as unknown as Record<string, string>
      })
    ).toEqual({ "X-Count": "5", "X-Flag": "true" });
  });

  it("rejects an invalid header name even when its value is empty", () => {
    expect(() => toHeaders({ headers: { "Bad Name": "" } })).toThrow(
      /header name "Bad Name" is not valid/
    );
  });

  it("adds Nodemailer's priority headers, replacing custom ones of the same name", () => {
    const headers = toHeaders({ priority: "HIGH", headers: { "x-priority": "3", "X-Tag": "a" } });

    expect(headers).toEqual({
      "x-priority": "1 (Highest)",
      "X-Tag": "a",
      "X-MSMail-Priority": "High",
      Importance: "High"
    });
    expect(Object.keys(headers ?? {})).toEqual([
      "x-priority",
      "X-Tag",
      "X-MSMail-Priority",
      "Importance"
    ]);
    expect(toHeaders({ priority: "low" })).toEqual({
      "X-Priority": "5 (Lowest)",
      "X-MSMail-Priority": "Low",
      Importance: "Low"
    });
    expect(toHeaders({ priority: "normal" })).toBeUndefined();
  });
  it("reads option headers from the values Nodemailer normalized", () => {
    expect(
      toHeaders({
        inReplyTo: "parent@example.com",
        references: ["a@example.com"],
        list: { help: "https://example.com/help", empty: [] },
        normalizedHeaders: {
          "in-reply-to": "<parent@example.com>",
          references: "<a@example.com>",
          "list-help": "<https://example.com/help>",
          "list-empty": ""
        }
      })
    ).toEqual({
      "in-reply-to": "<parent@example.com>",
      references: "<a@example.com>",
      "list-help": "<https://example.com/help>"
    });
  });

  it("keeps a custom header when its option has no value", () => {
    expect(
      toHeaders({
        headers: { "List-Help": "<https://custom.example.com>" },
        list: { help: [] },
        normalizedHeaders: { "List-Help": "<https://custom.example.com>", "list-help": "" }
      })
    ).toEqual({ "List-Help": "<https://custom.example.com>" });
  });

  it("uses Nodemailer's encoding of a single custom References value", () => {
    expect(
      toHeaders({
        headers: { references: "a@example.com" },
        normalizedHeaders: { references: "<a@example.com>" }
      })
    ).toEqual({ references: "<a@example.com>" });
  });

  it("does not read numbered normalized headers for headers given as a list", () => {
    expect(
      toHeaders({
        headers: [{ key: "0", value: "own" }],
        normalizedHeaders: { "0": "other" }
      })
    ).toEqual({ "0": "own" });
  });
});

describe("contentIdReferences", () => {
  it("finds cid references in image sources and backgrounds, quoted or not", () => {
    expect(
      contentIdReferences(
        `<img alt="a" src="cid:one@acme"><IMG src='cid:two'><td background=cid:three>` +
          `<a href="cid:not-an-image">`
      )
    ).toEqual(new Set(["one@acme", "two", "three"]));
    expect(contentIdReferences(undefined)).toEqual(new Set());
  });
});

describe("toAttachments", () => {
  it("returns undefined when there is nothing to attach", () => {
    expect(toAttachments()).toBeUndefined();
    expect(toAttachments([])).toBeUndefined();
  });

  it("names an attachment without a filename from its position and content type", () => {
    expect(
      toAttachments(
        [
          { cid: "logo@brudcast", content: Buffer.from("x"), contentType: "image/png" },
          { content: "y" },
          { filename: "", content: "z", contentType: "text/x-custom" },
          { filename: false, content: "z", contentType: "Application/PDF" }
        ],
        new Set(["logo@brudcast"])
      )
    ).toEqual([
      {
        filename: "attachment-1.png",
        content: "eA==",
        encoding: "base64",
        contentType: "image/png",
        cid: "logo@brudcast"
      },
      {
        filename: "attachment-2.bin",
        content: "eQ==",
        encoding: "base64",
        contentType: "application/octet-stream"
      },
      {
        filename: "attachment-3.txt",
        content: "eg==",
        encoding: "base64",
        contentType: "text/x-custom"
      },
      {
        filename: "attachment-4.pdf",
        content: "eg==",
        encoding: "base64",
        contentType: "Application/PDF"
      }
    ]);
  });

  it("counts skipped entries when numbering attachments, as Nodemailer does", () => {
    expect(toAttachments([null as never, { content: "x" }])?.map(item => item.filename)).toEqual([
      "attachment-2.bin"
    ]);
  });

  it("keeps a filename of 0", () => {
    expect(toAttachments([{ filename: "0", content: "x" }])?.[0]?.filename).toBe("0");
  });

  it("sends a cid without angle brackets", () => {
    expect(
      toAttachments(
        [{ filename: "logo.png", cid: "<logo@brudcast>", content: "x" }],
        new Set(["logo@brudcast"])
      )?.[0]?.cid
    ).toBe("logo@brudcast");
  });

  it("sends a referenced cid the service would reject as a regular attachment", () => {
    const long = "x".repeat(256);
    const attachments = toAttachments(
      [
        { filename: "a.png", cid: "my logo", content: "x" },
        { filename: "b.png", cid: long, content: "x" }
      ],
      new Set(["my logo", long])
    );

    expect(attachments?.map(item => item.cid)).toEqual([undefined, undefined]);
  });

  it.each([
    ["a non-breaking space after the tag name", `<img\u00a0src="cid:logo">`, undefined],
    ["non-breaking spaces around the equals sign", `<img src\u00a0=\u00a0"cid:logo">`, undefined],
    ["a non-breaking space ending an unquoted cid", `<img src=cid:logo\u00a0x>`, undefined],
    ["an ASCII space ending an unquoted cid", `<img src=cid:logo x>`, "logo"],
    [
      "a later reference too long for the service",
      `<img src="cid:logo" src="cid:${"x".repeat(300)}">`,
      undefined
    ]
  ])("gives the same cid as the Laravel transport for %s", (_label, html, cid) => {
    const attachments = toAttachments(
      [{ filename: "logo.png", cid: "logo", content: "x" }],
      contentIdReferences(html)
    );

    expect(attachments?.[0]?.cid).toBe(cid);
  });

  it("re-encodes strings in other encodings", () => {
    const attachment = toAttachments([
      { filename: "hex.txt", content: "68656c6c6f", encoding: "hex", contentType: "text/plain" }
    ])?.[0];

    expect(Buffer.from(attachment?.content ?? "", "base64").toString()).toBe("hello");
  });

  it.each([
    ["missing content", { filename: "empty.txt" }],
    ["an empty string", { filename: "empty.txt", content: "" }],
    ["an empty buffer", { filename: "empty.txt", content: Buffer.alloc(0) }],
    ["empty base64", { filename: "empty.txt", content: "", encoding: "base64" }],
    [
      "the attachment Nodemailer nests as its own content",
      { filename: "empty.txt", content: { filename: "empty.txt", content: "" } }
    ]
  ])("rejects %s as an empty attachment", (_label, attachment) => {
    expect(() => toAttachments([attachment])).toThrow(
      new TypeError('The attachment "empty.txt" is empty.')
    );
  });

  it("rejects raw attachments, which Nodemailer leaves as an object", () => {
    expect(() =>
      toAttachments([
        { filename: "raw.bin", content: { raw: "Content-Type: text/plain\r\n\r\nx" } }
      ])
    ).toThrow(/raw.*not support/);
  });
});

describe("renderHtml", () => {
  it("prefers explicit html over a template", async () => {
    const html = await renderHtml({
      html: "<p>explicit</p>",
      template: { name: path.join(fixtures, "welcome.hbs"), engine: "handlebars" }
    });

    expect(html).toBe("<p>explicit</p>");
  });

  it("ignores templates that are not engine objects", async () => {
    expect(await renderHtml({ template: "provider-hosted-template" })).toBeUndefined();
    expect(await renderHtml({ template: { name: "welcome.hbs" } })).toBeUndefined();
    expect(await renderHtml({})).toBeUndefined();
  });

  it("renders with an empty context by default", async () => {
    const html = await renderHtml({
      template: { name: path.join(fixtures, "welcome.hbs"), engine: "handlebars" }
    });

    expect(html).toBe("<body><h1></h1></body>");
  });

  it("rejects an unknown engine", async () => {
    await expect(
      renderHtml({ template: { name: "welcome.tpl", engine: "not-an-engine" } })
    ).rejects.toThrow('Unsupported template engine "not-an-engine"');
  });
});

/**
 * The pattern the scan must match exactly, as the Laravel transport runs it in PHP: over the
 * UTF-8 bytes, held here one per character, with `\s` as ASCII whitespace and `.` as any byte but
 * a line feed
 */
const SPACE = "[\\t\\n\\v\\f\\r ]";
const REFERENCE_PATTERN = new RegExp(
  `<(?:img${SPACE}+[^>]{0,4000}src|\\w+${SPACE}+[^>]{0,4000}background)${SPACE}*=${SPACE}*` +
    `(?:(['"])cid:([^\\n]{1,765}?)\\1|cid:([^>\\t\\n\\v\\f\\r ]{1,765})(?=[>\\t\\n\\v\\f\\r ]|$))`,
  "gi"
);

const referencesByPattern = (html: string): Set<string> =>
  new Set(
    [...Buffer.from(html, "utf8").toString("latin1").matchAll(REFERENCE_PATTERN)].map(match =>
      new TextDecoder("utf-8", { fatal: false }).decode(
        Buffer.from((match[2] ?? match[3]) as string, "latin1")
      )
    )
  );

/**
 * A small deterministic random number generator, so a failure can be reproduced
 */
const random = (seed: number) => () => {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
};

describe("contentIdReferences scan", () => {
  const cases: [string, string, string[]][] = [
    ["the last reference in a tag", `<img src="cid:a" data-src="cid:b">`, ["b"]],
    ["a cid of 0", `<img src="cid:0">`, ["0"]],
    ["a background on any tag", `<td  class="x" BACKGROUND = 'cid:bg'>`, ["bg"]],
    ["an unquoted cid at the end", `<img src=cid:end`, ["end"]],
    ["a quoted cid holding a quote", `<img src="cid:"x">`, [`"x`]],
    ["no reference across a closing bracket", `<img alt="x"> src="cid:a"`, []],
    ["no reference across a line in quotes", `<img src="cid:a\nb">`, []],
    ["a Kelvin sign, which is not a k", `<td bacKground="cid:a">`, []],
    ["a long run of whitespace", `<img${" ".repeat(5000)}src="cid:a">`, ["a"]],
    ["an attribute run of 4000", `<img ${"x".repeat(4000)}src="cid:a">`, ["a"]],
    ["an attribute run of 4001", `<img ${"x".repeat(4001)}src="cid:a">`, []],
    ["a quoted cid of 765 bytes", `<img src="cid:${"c".repeat(765)}">`, ["c".repeat(765)]],
    ["a quoted cid of 766 bytes", `<img src="cid:${"c".repeat(766)}">`, []],
    ["an unquoted cid of 765 bytes", `<img src=cid:${"c".repeat(765)}>`, ["c".repeat(765)]],
    ["an unquoted cid of 766 bytes", `<img src=cid:${"c".repeat(766)}>`, []],
    ["a cid of 382 two-byte characters", `<img src="cid:${"é".repeat(382)}">`, ["é".repeat(382)]],
    ["a cid of 383 two-byte characters", `<img src="cid:${"é".repeat(383)}">`, []],
    [
      "a later reference too long for the service",
      `<img src="cid:good" src="cid:${"x".repeat(300)}">`,
      ["x".repeat(300)]
    ],
    ["a non-breaking space after the tag name", `<img\u00a0src="cid:a">`, []],
    ["non-breaking spaces around the equals sign", `<img src\u00a0=\u00a0"cid:a">`, []],
    ["a non-breaking space in an unquoted cid", `<img src=cid:a\u00a0b>`, ["a\u00a0b"]],
    ["a carriage return in quotes", `<img src="cid:a\rb">`, ["a\rb"]],
    ["a line separator in quotes", `<img src="cid:a\u2028b">`, ["a\u2028b"]],
    ["a non-ASCII cid", `<img src="cid:café">`, ["café"]]
  ];

  it.each(cases)("matches the reference pattern for %s", (_label, html, expected) => {
    expect(contentIdReferences(html)).toEqual(new Set(expected));
    expect(referencesByPattern(html)).toEqual(new Set(expected));
  });

  it("finds exactly what the reference pattern finds in random markup", () => {
    const next = random(42);
    const tokens = [
      "<",
      ">",
      "img",
      "IMG",
      "td",
      " ",
      "\n",
      "\u00a0",
      "src",
      "Src",
      "background",
      "=",
      '"',
      "'",
      "cid:",
      "CID:",
      "a",
      "é",
      "\u00a0",
      "\r",
      "x@y",
      "_",
      " "
    ];
    for (let run = 0; run < 3000; run++) {
      const length = 1 + Math.floor(next() * 40);
      const html = Array.from(
        { length },
        () => tokens[Math.floor(next() * tokens.length)] as string
      ).join("");
      expect(contentIdReferences(html), JSON.stringify(html)).toEqual(referencesByPattern(html));
    }
  });

  it.each([
    ["unclosed tags", "<a ".repeat(100_000)],
    ["unclosed image tags", "<img ".repeat(60_000)],
    ["unclosed background tags", "<a background ".repeat(21_000)],
    ["a quote that never closes", `<img src="cid:${"x".repeat(300_000)}`],
    ["many quotes that never close", `<img src="cid:${"x".repeat(300)}`.repeat(1_000)],
    ["a run of whitespace", `<a${" ".repeat(300_000)}`],
    ["many sources before whitespace", `${"<img src".repeat(500)}${" ".repeat(300_000)}cid:a`]
  ])("scans 300 KB of %s in well under a second", (_label, html) => {
    const started = performance.now();

    contentIdReferences(html);

    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe("attachment content", () => {
  it.each([
    ["us-ascii", "hello", "hello"],
    ["US-ASCII", "hello", "hello"],
    ["ascii", "hello", "hello"],
    ["UTF-8", "héllo", "héllo"],
    ["utf8", "héllo", "héllo"],
    ["Base64", "aGVsbG8=", "hello"],
    ["HEX", "68656c6c6f", "hello"],
    ["binary", "hé", "hé"],
    ["latin1", "hé", "hé"],
    ["not-an-encoding", "héllo", "héllo"],
    ["constructor", "héllo", "héllo"]
  ])("reads text in the %s encoding", (encoding, content, text) => {
    const attachment = toAttachments([{ filename: "a.txt", content, encoding }])?.[0];
    const decoded = Buffer.from(attachment?.content ?? "", "base64");

    expect(
      ["binary", "latin1"].includes(encoding) ? decoded.toString("latin1") : decoded.toString()
    ).toBe(text);
  });

  it("sends binary views and buffers as bytes", () => {
    const bytes = new Uint8Array([104, 105, 33]);
    const attachments = toAttachments([
      { filename: "a.bin", content: bytes },
      { filename: "b.bin", content: new DataView(bytes.buffer, 1, 2) },
      { filename: "c.bin", content: bytes.buffer },
      { filename: "d.bin", content: new Uint16Array([0x6968]) }
    ]);

    expect(attachments?.map(item => Buffer.from(item.content, "base64").toString())).toEqual([
      "hi!",
      "i!",
      "hi!",
      "hi"
    ]);
  });

  it.each([
    ["an empty Uint8Array", new Uint8Array(0)],
    ["an empty ArrayBuffer", new ArrayBuffer(0)]
  ])("rejects %s as empty", (_label, content) => {
    expect(() => toAttachments([{ filename: "empty.bin", content }])).toThrow(
      new TypeError('The attachment "empty.bin" is empty.')
    );
  });

  it.each([
    ["a plain object", { value: 1 }],
    ["an array", ["x"]],
    ["a date", new Date(0)],
    ["another attachment's content", { filename: "other.txt", content: "" }]
  ])("rejects %s as content of an unsupported type", (_label, content) => {
    expect(() => toAttachments([{ filename: "a.bin", content }])).toThrow(
      new TypeError('The attachment "a.bin" has content of an unsupported type.')
    );
  });
});

describe("message ID headers", () => {
  it.each([
    ["a bare id", "a@example.com", "<a@example.com>"],
    [
      "ids split by whitespace",
      " a@example.com\tb@example.com ",
      "<a@example.com> <b@example.com>"
    ],
    ["adjacent bracketed ids", "<a@example.com><b@example.com>", "<a@example.com> <b@example.com>"],
    ["an id bracketed on one side", "<a@example.com", "<a@example.com>"]
  ])("writes References and In-Reply-To given as %s as bracketed ids", (_label, value, ids) => {
    expect(toHeaders({ headers: { References: value, "in-reply-to": [value] } })).toEqual({
      References: ids,
      "in-reply-to": ids
    });
  });

  it("drops a References header without ids", () => {
    expect(toHeaders({ headers: { References: "< >", "X-Tag": "a" } })).toEqual({ "X-Tag": "a" });
  });

  it("validates list keys as header names", () => {
    expect(() => toHeaders({ list: { "help:": "x" } })).toThrow(
      new TypeError('The header name "list-help:" is not valid')
    );
  });
});
