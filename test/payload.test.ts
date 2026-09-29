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
    expect(toHeaders({ priority: "HIGH", headers: { "x-priority": "3", "X-Tag": "a" } })).toEqual({
      "X-Tag": "a",
      "X-Priority": "1 (Highest)",
      "X-MSMail-Priority": "High",
      Importance: "High"
    });
    expect(toHeaders({ priority: "low" })).toEqual({
      "X-Priority": "5 (Lowest)",
      "X-MSMail-Priority": "Low",
      Importance: "Low"
    });
    expect(toHeaders({ priority: "normal" })).toBeUndefined();
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

  it("fills in a filename and content type when missing", () => {
    expect(
      toAttachments(
        [{ cid: "logo@brudcast", content: Buffer.from("x") }, { content: "y" }],
        new Set(["logo@brudcast"])
      )
    ).toEqual([
      {
        filename: "logo@brudcast",
        content: "eA==",
        encoding: "base64",
        contentType: "application/octet-stream",
        cid: "logo@brudcast"
      },
      {
        filename: "attachment-2",
        content: "eQ==",
        encoding: "base64",
        contentType: "application/octet-stream"
      }
    ]);
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

  it("re-encodes strings in other encodings", () => {
    const attachment = toAttachments([
      { filename: "hex.txt", content: "68656c6c6f", encoding: "hex", contentType: "text/plain" }
    ])?.[0];

    expect(Buffer.from(attachment?.content ?? "", "base64").toString()).toBe("hello");
  });

  it("treats missing content as empty", () => {
    const attachment = toAttachments([{ filename: "empty.txt" }])?.[0];

    expect(attachment).toMatchObject({ filename: "empty.txt", content: "" });
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
