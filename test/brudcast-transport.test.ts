import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import brudcastTransport, { BrudcastError, DEFAULT_URL } from "../src";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });

const accepted = () =>
  jsonResponse(202, {
    status: true,
    message: "Email queued for delivery",
    data: { jobId: "job-123" }
  });

const fetchMock = vi.fn<typeof fetch>();

const createTransport = (options: { url?: string } = {}) =>
  nodemailer.createTransport(brudcastTransport({ auth: { apiKey: "sk_test" }, ...options }));

const lastRequest = () => {
  const [url, init] = fetchMock.mock.calls.at(-1) ?? [];
  return {
    url: String(url),
    init: init as RequestInit & { headers: Record<string, string> },
    body: JSON.parse(String(init?.body))
  };
};

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => accepted());
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("brudcastTransport", () => {
  it("requires a sending key", () => {
    expect(() => brudcastTransport({ auth: { apiKey: "" } })).toThrow(/auth\.apiKey/);
    expect(() => brudcastTransport(undefined as never)).toThrow(TypeError);
  });

  it.each([
    ["auth.apiKey", { auth: { apiKey: "sk_alias" } }],
    ["auth.api_key", { auth: { api_key: "sk_alias" } }],
    ["apiKey", { apiKey: "sk_alias" }]
  ])("accepts the sending key as %s", async (_label, options) => {
    await nodemailer
      .createTransport(brudcastTransport(options))
      .sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" });

    expect(lastRequest().init.headers.Authorization).toBe("Bearer sk_alias");
  });

  it("supports the nodemailer callback style", async () => {
    const info = await new Promise((resolve, reject) =>
      createTransport().sendMail(
        { from: "a@example.com", to: "b@example.com", subject: "s", text: "t" },
        (error, result) => (error ? reject(error) : resolve(result))
      )
    );

    expect(info).toMatchObject({ jobId: "job-123" });
  });

  it("posts to the production send endpoint with the sending key", async () => {
    const info = await createTransport().sendMail({
      from: "Sales <sales@example.com>",
      to: "mary@example.org",
      subject: "Hello",
      text: "Hi there"
    });

    const request = lastRequest();
    expect(DEFAULT_URL).toBe("https://mailing-service.brudcast.com");
    expect(request.url).toBe("https://mailing-service.brudcast.com/api/v1/send");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers.Authorization).toBe("Bearer sk_test");
    expect(info).toEqual({
      messageId: "<job-123@brudcast-mailing-service>",
      jobId: "job-123",
      envelope: { from: "sales@example.com", to: ["mary@example.org"] },
      accepted: ["mary@example.org"],
      rejected: [],
      pending: [],
      response: "202 Email queued for delivery"
    });
  });

  it("honours a custom url", async () => {
    await createTransport({ url: "http://localhost:3000" }).sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t"
    });

    expect(lastRequest().url).toBe("http://localhost:3000/api/v1/send");
  });

  it("maps addresses, content and headers onto the send schema", async () => {
    await createTransport().sendMail({
      from: { name: "Sales", address: "sales@example.com" },
      to: ["Mary <mary@example.org>", { name: "", address: "john@example.org" }],
      cc: "cc@example.org",
      bcc: "bcc@example.org",
      replyTo: "Support <support@example.com>",
      subject: "Hello",
      text: "plain",
      html: "<b>rich</b>",
      headers: { "X-Campaign": "autumn" }
    });

    expect(lastRequest().body).toEqual({
      from: { name: "Sales", address: "sales@example.com" },
      to: [{ name: "Mary", address: "mary@example.org" }, { address: "john@example.org" }],
      cc: [{ address: "cc@example.org" }],
      bcc: [{ address: "bcc@example.org" }],
      replyTo: { address: "support@example.com" },
      subject: "Hello",
      text: "plain",
      html: "<b>rich</b>",
      headers: { "X-Campaign": "autumn" }
    });
  });

  it("joins repeated headers into one value", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t",
      headers: {
        "X-Tag": ["welcome", { value: "onboarding" }],
        "x-tag": "autumn",
        "X-Campaign": "autumn"
      }
    });

    expect(lastRequest().body.headers).toEqual({
      "X-Tag": "welcome, onboarding, autumn",
      "X-Campaign": "autumn"
    });
  });

  it("reads headers given as a list", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t",
      headers: [
        { key: "X-Tag", value: "welcome" },
        { key: "X-Tag", value: "onboarding" },
        { key: "X-Campaign", value: "autumn" }
      ]
    });

    expect(lastRequest().body.headers).toEqual({
      "X-Tag": "welcome, onboarding",
      "X-Campaign": "autumn"
    });
  });

  it("keeps the headers nodemailer builds from message fields", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t",
      references: "first@example.com",
      list: { unsubscribe: "https://example.com/unsubscribe" }
    });

    expect(lastRequest().body.headers).toEqual({
      references: "<first@example.com>",
      "list-unsubscribe": "<https://example.com/unsubscribe>"
    });
  });

  it("sends every attachment as base64", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "files",
      text: "see attached",
      attachments: [
        { filename: "buffer.txt", content: Buffer.from("hello world!") },
        { filename: "plain.txt", content: "hello world!" },
        { filename: "encoded.txt", content: "aGVsbG8gd29ybGQh", encoding: "base64" },
        { filename: "file.txt", path: path.join(fixtures, "hello.txt") }
      ]
    });

    const { attachments } = lastRequest().body;
    expect(attachments).toHaveLength(4);
    for (const attachment of attachments) {
      expect(attachment.encoding).toBe("base64");
      expect(attachment.contentType).toBe("text/plain");
      expect(Buffer.from(attachment.content, "base64").toString().trim()).toBe("hello world!");
    }
  });

  it("renders consolidate templates into html", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "templated",
      template: {
        name: path.join(fixtures, "welcome.hbs"),
        engine: "handlebars",
        context: { variable1: "Hi Mary" }
      }
    } as SendMailOptions);

    expect(lastRequest().body.html).toBe("<body><h1>Hi Mary</h1></body>");
  });

  it("surfaces validation errors from the service", async () => {
    const errors = [{ path: ["text"], message: "At least one of 'text' or 'html' is required" }];
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { status: false, message: "Validation error", errors })
    );

    const failure = createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s"
    });

    await expect(failure).rejects.toBeInstanceOf(BrudcastError);
    await expect(failure).rejects.toMatchObject({
      message: "Validation error",
      statusCode: 422,
      errors
    });
  });

  it("surfaces non-JSON failures", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Bad Gateway", { status: 502 }));

    await expect(
      createTransport().sendMail({
        from: "a@example.com",
        to: "b@example.com",
        subject: "s",
        text: "t"
      })
    ).rejects.toMatchObject({ message: "Bad Gateway", statusCode: 502 });
  });
});

describe("transport contract", () => {
  it("exposes its name, version and options to nodemailer", () => {
    const options = { auth: { apiKey: "sk_test" } };
    const transport = brudcastTransport(options);

    expect(transport.name).toBe("Brudcast");
    expect(transport.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(transport.options).toBe(options);
  });

  it("passes normalize failures to the callback without calling the API", async () => {
    const failure = new Error("could not read attachment");
    const info = await new Promise<unknown>(resolve =>
      brudcastTransport({ auth: { apiKey: "sk_test" } }).send(
        { normalize: callback => callback(failure, {}) },
        error => resolve(error)
      )
    );

    expect(info).toBe(failure);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the HTTP status when the error body has no message", async () => {
    fetchMock.mockResolvedValueOnce(new Response("", { status: 503 }));

    await expect(
      createTransport().sendMail({
        from: "a@example.com",
        to: "b@example.com",
        subject: "s",
        text: "t"
      })
    ).rejects.toMatchObject({ message: "Brudcast responded with HTTP 503", statusCode: 503 });
  });

  it("treats an accepted response without a body as queued", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 202 }));

    const info = await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t"
    });

    expect(info).toMatchObject({ jobId: "", messageId: "", response: "202 Accepted" });
  });

  it("aborts requests that exceed the timeout", async () => {
    fetchMock.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason))
        )
    );

    await expect(
      nodemailer
        .createTransport(brudcastTransport({ auth: { apiKey: "sk_test" }, timeout: 10 }))
        .sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" })
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});

describe("verify", () => {
  it("resolves true when the service accepts the sending key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { status: false, message: "Validation error" })
    );

    await expect(createTransport().verify()).resolves.toBe(true);
    expect(lastRequest().body).toEqual({});
  });

  it("reports an unknown sending key", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { status: false, message: "Unauthorized" }));

    await expect(createTransport().verify()).rejects.toMatchObject({
      message: "Unauthorized",
      statusCode: 401
    });
  });

  it("supports the callback style", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { status: false }));

    const result = await new Promise((resolve, reject) =>
      createTransport().verify((error, success) => (error ? reject(error) : resolve(success)))
    );

    expect(result).toBe(true);
  });
});

describe("lifecycle", () => {
  it("is always idle and closes without side effects", () => {
    const transporter = createTransport();

    expect(transporter.isIdle()).toBe(true);
    expect(() => transporter.close()).not.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
