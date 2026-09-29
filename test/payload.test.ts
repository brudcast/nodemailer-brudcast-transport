import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPayload, renderHtml, toAttachments } from "../src/payload";

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

  it("keeps only the first reply-to address and strips its name", async () => {
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
    expect(payload.replyTo).toEqual({ address: "support@example.com" });
  });
});

describe("toAttachments", () => {
  it("returns undefined when there is nothing to attach", () => {
    expect(toAttachments()).toBeUndefined();
    expect(toAttachments([])).toBeUndefined();
  });

  it("fills in a filename and content type when missing", () => {
    expect(
      toAttachments([{ cid: "logo@brudcast", content: Buffer.from("x") }, { content: "y" }])
    ).toEqual([
      {
        filename: "logo@brudcast",
        content: "eA==",
        encoding: "base64",
        contentType: "application/octet-stream"
      },
      {
        filename: "attachment-2",
        content: "eQ==",
        encoding: "base64",
        contentType: "application/octet-stream"
      }
    ]);
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
