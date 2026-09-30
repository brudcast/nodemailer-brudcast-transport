import path from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer, { type SendMailOptions } from "nodemailer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { version as packageVersion } from "../package.json";
import brudcastTransport, {
  BrudcastError,
  type BrudcastSendMailOptions,
  type BrudcastTransportOptions,
  DEFAULT_URL
} from "../src";

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

const createTransport = (options: BrudcastTransportOptions = {}) =>
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

  it("posts to the default send endpoint with the sending key", async () => {
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
    expect(request.init.headers).toEqual({
      Authorization: "Bearer sk_test",
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": `nodemailer-brudcast-transport/${packageVersion}`
    });
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
    await createTransport({ url: "http://localhost:3000", insecure: true }).sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t"
    });

    expect(lastRequest().url).toBe("http://localhost:3000/api/v1/send");
  });

  it("keeps the path of a custom url", async () => {
    await createTransport({ url: "https://proxy.example.com/brudcast/" }).sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t"
    });

    expect(lastRequest().url).toBe("https://proxy.example.com/brudcast/api/v1/send");
  });

  it("refuses plain http without insecure, even to localhost", () => {
    expect(() => createTransport({ url: "http://mailing-service.brudcast.com" })).toThrow(
      /https url/
    );
    expect(() => createTransport({ url: "http://localhost:3000" })).toThrow(/https url/);
    expect(() => createTransport({ url: "http://127.0.0.1:3000" })).toThrow(/https url/);
    expect(() => createTransport({ url: "ftp://localhost", insecure: true })).toThrow(/https url/);
  });

  it("trims whitespace around the sending key", async () => {
    await nodemailer
      .createTransport(brudcastTransport({ auth: { apiKey: "  sk_test\n" } }))
      .sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" });

    expect(lastRequest().init.headers.Authorization).toBe("Bearer sk_test");
    expect(() => brudcastTransport({ auth: { apiKey: " \n" } })).toThrow(/auth\.apiKey/);
  });

  it("allows plain http to any host with insecure", async () => {
    await createTransport({ url: "http://mailing-service:3000", insecure: true }).sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t"
    });

    expect(lastRequest().url).toBe("http://mailing-service:3000/api/v1/send");
    expect(() => createTransport({ url: "ftp://mailing-service", insecure: true })).toThrow(
      /https url/
    );
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
      replyTo: { name: "Support", address: "support@example.com" },
      subject: "Hello",
      text: "plain",
      html: "<b>rich</b>",
      headers: { "X-Campaign": "autumn" }
    });
  });

  it("sends every From and Reply-To address as a list", async () => {
    await createTransport().sendMail({
      from: ["Ann <ann@example.com>", { name: "Doe, Bob", address: "bob@example.com" }],
      to: "b@example.com",
      replyTo: ["Support <support@example.com>", "billing@example.com"],
      subject: "s",
      text: "t"
    });

    expect(lastRequest().body).toMatchObject({
      from: [
        { name: "Ann", address: "ann@example.com" },
        { name: "Doe, Bob", address: "bob@example.com" }
      ],
      replyTo: [
        { name: "Support", address: "support@example.com" },
        { address: "billing@example.com" }
      ]
    });
  });

  it("leaves out headers the mailing service owns", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t",
      headers: {
        From: "spoof@elsewhere.com",
        sender: "spoof@elsewhere.com",
        "Reply-To": "spoof@elsewhere.com",
        "Message-ID": "<mine@example.com>",
        "X-Campaign": "autumn"
      }
    });

    expect(lastRequest().body.headers).toEqual({ "X-Campaign": "autumn" });
  });

  it("sends to the envelope recipients that are not copied", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "Customer <customer@example.com>",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
      envelope: {
        from: "a@example.com",
        to: ["CUSTOMER@example.com", "cc@example.com", "bcc@example.com", "extra@example.com"]
      },
      subject: "s",
      text: "t"
    });

    expect(lastRequest().body).toMatchObject({
      to: [{ name: "Customer", address: "customer@example.com" }, { address: "extra@example.com" }],
      cc: [{ address: "cc@example.com" }],
      bcc: [{ address: "bcc@example.com" }]
    });
  });

  it("replaces line breaks in header values", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t",
      headers: { "X-Note": "one\r\nBcc: c@example.com\ntwo" }
    });

    expect(lastRequest().body.headers).toEqual({ "X-Note": "one Bcc: c@example.com two" });
  });

  it("sends priority as the headers Nodemailer adds over SMTP", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t",
      priority: "high"
    });

    expect(lastRequest().body.headers).toEqual({
      "X-Priority": "1 (Highest)",
      "X-MSMail-Priority": "High",
      Importance: "High"
    });
  });

  it("rejects an invalid header name without calling the API", async () => {
    await expect(
      createTransport().sendMail({
        from: "a@example.com",
        to: "b@example.com",
        subject: "s",
        text: "t",
        headers: { "X Bad:Name": "x" }
      })
    ).rejects.toThrow(/header name "X Bad:Name" is not valid/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends an attachment inline only when the HTML references its cid", async () => {
    await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      html: '<img src="cid:logo@acme">',
      attachments: [
        { filename: "logo.png", cid: "<logo@acme>", content: "x" },
        { filename: "extra.png", cid: "extra@acme", content: "y" }
      ]
    });

    const [logo, extra] = lastRequest().body.attachments;
    expect(logo).toMatchObject({ filename: "logo.png", cid: "logo@acme" });
    expect(extra).not.toHaveProperty("cid");
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
    const message: SendMailOptions & BrudcastSendMailOptions = {
      from: "a@example.com",
      to: "b@example.com",
      subject: "templated",
      template: {
        name: path.join(fixtures, "welcome.hbs"),
        engine: "handlebars",
        context: { variable1: "Hi Mary" }
      }
    };
    await createTransport().sendMail(message);

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

  it("fails a redirect with its target instead of following it", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 301, headers: { Location: "https://new.example.com/" } })
    );

    await expect(
      createTransport().sendMail({
        from: "a@example.com",
        to: "b@example.com",
        subject: "s",
        text: "t"
      })
    ).rejects.toMatchObject({
      message: expect.stringContaining('redirected to "https://new.example.com/"'),
      statusCode: 301
    });
    expect(lastRequest().init.redirect).toBe("manual");
  });

  it("counts a 2xx without a JSON body as sent, so a retry does not send twice", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>OK</html>", { status: 200 }));

    const info = await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t"
    });

    expect(info.messageId).toBe("");
  });

  const failingBody = (status: number): Response =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.error(new Error("socket hang up"));
        }
      }),
      { status }
    );

  it("counts a 2xx whose body fails mid-read as sent, not as unreachable", async () => {
    fetchMock.mockResolvedValueOnce(failingBody(202));

    const info = await createTransport().sendMail({
      from: "a@example.com",
      to: "b@example.com",
      subject: "s",
      text: "t"
    });

    expect(info.response).toBe("202 Accepted");
  });

  it("keeps the real status when an error body fails mid-read", async () => {
    fetchMock.mockResolvedValueOnce(failingBody(503));

    await expect(
      createTransport().sendMail({
        from: "a@example.com",
        to: "b@example.com",
        subject: "s",
        text: "t"
      })
    ).rejects.toMatchObject({ statusCode: 503, message: "Brudcast responded with HTTP 503" });
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

    const failure = nodemailer
      .createTransport(brudcastTransport({ auth: { apiKey: "sk_test" }, timeout: 10 }))
      .sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" });

    await expect(failure).rejects.toBeInstanceOf(BrudcastError);
    await expect(failure).rejects.toMatchObject({
      message: expect.stringMatching(/^Could not reach the Brudcast mailing service: /),
      statusCode: 0,
      cause: expect.objectContaining({ name: "TimeoutError" })
    });
  });
});

describe("verify", () => {
  it("resolves true when the service accepts the sending key", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, { status: false, message: "Validation error", errors: [] })
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
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { status: false, errors: [] }));

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

const send = (message: SendMailOptions = {}, options: BrudcastTransportOptions = {}) =>
  createTransport(options).sendMail({
    from: "a@example.com",
    to: "b@example.com",
    subject: "s",
    text: "t",
    ...message
  });

describe("options", () => {
  it("skips a sending key candidate that is not a string", async () => {
    await nodemailer
      .createTransport(
        brudcastTransport({ auth: { apiKey: 123 as never, api_key: " " }, apiKey: "sk_top" })
      )
      .sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" });

    expect(lastRequest().init.headers.Authorization).toBe("Bearer sk_top");
  });

  it("trims only ASCII whitespace from the sending key", async () => {
    await nodemailer
      .createTransport(brudcastTransport({ apiKey: "\v\f\t sk_test \r\n" }))
      .sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" });

    expect(lastRequest().init.headers.Authorization).toBe("Bearer sk_test");
    expect(() => brudcastTransport({ apiKey: "sk_test\u3000" })).toThrow(
      "The Brudcast sending key contains characters that are not allowed."
    );
  });

  it.each([undefined, null, ""])("uses the default url when url is %j", async url => {
    await send({}, { url });

    expect(lastRequest().url).toBe(`${DEFAULT_URL}/api/v1/send`);
  });

  it("drops the query string and fragment of the url", async () => {
    await send({}, { url: "https://proxy.example.com/brudcast/?token=x#part" });

    expect(lastRequest().url).toBe("https://proxy.example.com/brudcast/api/v1/send");
  });

  it.each([
    "mailing-service.brudcast.com",
    "not a url",
    " https://mailing-service.brudcast.com",
    "https://mailing-service.brudcast.com\n",
    "https:\\\\mailing-service.brudcast.com",
    "https://",
    "file:///etc/passwd"
  ])("rejects the url %j as not valid", url => {
    expect(() => createTransport({ url })).toThrow(
      new TypeError(`The Brudcast url "${url}" is not a valid URL.`)
    );
  });

  it("rejects a url that is not a string", () => {
    expect(() => createTransport({ url: 3000 as never })).toThrow(
      new TypeError('The Brudcast url "3000" is not a valid URL.')
    );
  });

  it("rejects a url with a username or password without echoing it", () => {
    for (const url of ["https://user:secret@example.com", "https://user@example.com"]) {
      expect(() => createTransport({ url })).toThrow(
        new TypeError("The Brudcast url must not include a username or password.")
      );
    }
  });

  it.each([true, 1, "1", "true", " TRUE ", "on", "yes"])(
    "allows plain http when insecure is %j",
    async insecure => {
      await send({}, { url: "http://localhost:3000", insecure });

      expect(lastRequest().url).toBe("http://localhost:3000/api/v1/send");
    }
  );

  it.each([false, 0, 2, "0", "false", "off", "no", "", "y"])(
    "refuses plain http when insecure is %j",
    insecure => {
      expect(() => createTransport({ url: "http://localhost:3000", insecure })).toThrow(
        /https url/
      );
    }
  );

  it.each([
    [undefined, 30_000],
    [null, 30_000],
    [5000, 5000],
    [" 2500 ", 2500],
    ["1.5", 2]
  ])("reads a timeout of %j as %i ms", async (timeout, expected) => {
    const spy = vi.spyOn(AbortSignal, "timeout");

    await send({}, { timeout });

    expect(spy).toHaveBeenLastCalledWith(expected);
    spy.mockRestore();
  });

  it.each([
    0,
    -1,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    "",
    "abc",
    "-5",
    "1e3",
    ".5",
    "+5",
    "5.",
    "0",
    "\u00a05",
    "5\u3000",
    "\uff15",
    true,
    2_147_483_648,
    2_147_483_647.5,
    "2147483648",
    Number.MAX_VALUE
  ])("rejects a timeout of %j", timeout => {
    expect(() => createTransport({ timeout: timeout as never })).toThrow(
      new TypeError(
        "The Brudcast timeout must be a positive number of milliseconds no greater than 2147483647."
      )
    );
  });

  it.each([
    [0.5, 1],
    [2_147_483_647, 2_147_483_647],
    ["2147483646.2", 2_147_483_647],
    ["\t\v\f 42 \r\n", 42]
  ])("accepts a timeout of %j at the edges of the range as %i ms", async (timeout, expected) => {
    const spy = vi.spyOn(AbortSignal, "timeout");

    await send({}, { timeout });

    expect(spy).toHaveBeenLastCalledWith(expected);
    spy.mockRestore();
  });
});

describe("responses", () => {
  it("fails a 2xx whose body reports status false", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { status: false, message: "Not queued" }));

    await expect(send()).rejects.toMatchObject({ message: "Not queued", statusCode: 200 });
  });

  it.each([
    [400, "Domain not registered"],
    [403, "Sending is blocked for this domain"],
    [429, "Too many requests"]
  ])("passes the service's message through for a %i", async (status, message) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, { status: false, message }));

    const failure = send();

    await expect(failure).rejects.toBeInstanceOf(BrudcastError);
    await expect(failure).rejects.toMatchObject({ message, statusCode: status, errors: [] });
  });

  it.each([123, "", null, ["a"]])(
    "falls back to the HTTP status when the message is %j",
    async message => {
      fetchMock.mockResolvedValueOnce(jsonResponse(500, { status: false, message }));

      await expect(send()).rejects.toMatchObject({
        message: "Brudcast responded with HTTP 500",
        statusCode: 500
      });
    }
  );

  it.each([
    [{ text: { path: ["text"], message: "Required" } }, [{ path: ["text"], message: "Required" }]],
    ["invalid", []],
    [null, []],
    [undefined, []]
  ])("reads errors of %j as a list", async (errors, expected) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, { status: false, errors }));

    await expect(send()).rejects.toMatchObject({ errors: expected });
  });

  it("ignores a job id or message that is not a non-empty string", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(202, { status: true, message: 42, data: { jobId: 42 } })
    );

    await expect(send()).resolves.toMatchObject({
      jobId: "",
      messageId: "",
      response: "202 Accepted"
    });
  });

  it("wraps a network failure in a BrudcastError", async () => {
    const cause = new TypeError("fetch failed");
    fetchMock.mockRejectedValueOnce(cause);

    const failure = send();

    await expect(failure).rejects.toBeInstanceOf(BrudcastError);
    await expect(failure).rejects.toMatchObject({
      message: "Could not reach the Brudcast mailing service: fetch failed",
      statusCode: 0,
      response: {
        status: false,
        message: "Could not reach the Brudcast mailing service: fetch failed"
      },
      errors: [],
      cause
    });
  });

  it("wraps a rejection that is not an Error", async () => {
    fetchMock.mockRejectedValueOnce("offline");

    await expect(send()).rejects.toMatchObject({
      message: "Could not reach the Brudcast mailing service: offline",
      statusCode: 0
    });
  });
});

describe("verify strictness", () => {
  it("passes only the service's validation response", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        status: false,
        message: "Validation error",
        errors: [{ path: ["from"], message: "Required" }]
      })
    );

    await expect(createTransport().verify()).resolves.toBe(true);
  });

  it("fails a 422 with an HTML body", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("<html>Unprocessable</html>", {
        status: 422,
        headers: { "Content-Type": "text/html" }
      })
    );

    await expect(createTransport().verify()).rejects.toMatchObject({ statusCode: 422 });
  });

  it.each([
    [{ status: false }],
    [{ status: false, errors: {} }],
    [{ status: true, errors: [] }],
    [{ errors: [] }]
  ])("fails a 422 with the body %j", async body => {
    fetchMock.mockResolvedValueOnce(jsonResponse(422, body));

    await expect(createTransport().verify()).rejects.toMatchObject({
      message: "Brudcast responded with HTTP 422",
      statusCode: 422
    });
  });

  it("fails an unexpected success", async () => {
    fetchMock.mockResolvedValueOnce(accepted());

    await expect(createTransport().verify()).rejects.toMatchObject({ statusCode: 202 });
  });

  it("wraps a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    await expect(createTransport().verify()).rejects.toMatchObject({
      message: "Could not reach the Brudcast mailing service: fetch failed",
      statusCode: 0
    });
  });
});

describe("recipients", () => {
  it("sends the members of address groups", async () => {
    await send({
      to: "Team: Ann <ann@example.com>, bob@example.com;",
      cc: "Copies: Cy <cy@example.com>;",
      bcc: "Hidden: dee@example.com;"
    });

    expect(lastRequest().body).toMatchObject({
      to: [{ name: "Ann", address: "ann@example.com" }, { address: "bob@example.com" }],
      cc: [{ name: "Cy", address: "cy@example.com" }],
      bcc: [{ address: "dee@example.com" }]
    });
  });

  it("keeps a To recipient that is also copied in both lists", async () => {
    await send({
      to: "Mary <mary@example.com>",
      cc: "MARY@example.com",
      bcc: "mary@example.com"
    });

    expect(lastRequest().body).toMatchObject({
      to: [{ name: "Mary", address: "mary@example.com" }],
      cc: [{ address: "MARY@example.com" }],
      bcc: [{ address: "mary@example.com" }]
    });
  });

  it("sends only the Cc and Bcc addresses the envelope keeps", async () => {
    await send({
      to: "a@example.com",
      cc: ["cc@example.com", "cc-dropped@example.com"],
      bcc: ["bcc-dropped@example.com"],
      envelope: { from: "a@example.com", to: ["a@example.com", "CC@example.com"] }
    });

    const { body } = lastRequest();
    expect(body.to).toEqual([{ address: "a@example.com" }]);
    expect(body.cc).toEqual([{ address: "cc@example.com" }]);
    expect(body).not.toHaveProperty("bcc");
  });

  it("sends each address once, keeping the first", async () => {
    await send({
      to: ["Mary <mary@example.com>", "MARY@example.com", "john@example.com"],
      cc: ["cc@example.com", "Cc <CC@example.com>"]
    });

    expect(lastRequest().body).toMatchObject({
      to: [{ name: "Mary", address: "mary@example.com" }, { address: "john@example.com" }],
      cc: [{ address: "cc@example.com" }]
    });
  });

  it("orders To by the envelope, extra recipients included", async () => {
    await send({
      to: ["First <first@example.com>", "Second <second@example.com>"],
      envelope: {
        from: "a@example.com",
        to: ["extra@example.com", "second@example.com", "first@example.com"]
      }
    });

    expect(lastRequest().body.to).toEqual([
      { address: "extra@example.com" },
      { name: "Second", address: "second@example.com" },
      { name: "First", address: "first@example.com" }
    ]);
  });
});

describe("headers from message options", () => {
  it("sends X-Mailer only when xMailer is set, as Nodemailer does", async () => {
    await send();
    expect(lastRequest().body).not.toHaveProperty("headers");

    await send({ xMailer: "Acme Mailer 2.0" });
    expect(lastRequest().body.headers).toEqual({ "X-Mailer": "Acme Mailer 2.0" });

    await send({ xMailer: false, headers: { "X-Mailer": "custom" } });
    expect(lastRequest().body.headers).toEqual({ "X-Mailer": "custom" });
  });

  it("replaces a custom header with the option of the same name, in its place", async () => {
    await send({
      headers: {
        "X-First": "1",
        "In-Reply-To": "<custom@example.com>",
        "x-mailer": "custom",
        "LIST-UNSUBSCRIBE": "<https://custom.example.com>",
        "X-Last": "2"
      },
      inReplyTo: "parent@example.com",
      xMailer: "Acme",
      list: { unsubscribe: "https://example.com/unsubscribe" }
    });

    const { headers } = lastRequest().body;
    expect(headers).toEqual({
      "X-First": "1",
      "In-Reply-To": "<parent@example.com>",
      "x-mailer": "Acme",
      "LIST-UNSUBSCRIBE": "<https://example.com/unsubscribe>",
      "X-Last": "2"
    });
    expect(Object.keys(headers)).toEqual([
      "X-First",
      "In-Reply-To",
      "x-mailer",
      "LIST-UNSUBSCRIBE",
      "X-Last"
    ]);
  });

  it("joins repeated References and In-Reply-To values with a space", async () => {
    await send({
      headers: {
        References: ["<a@example.com>", "<b@example.com>"],
        "In-Reply-To": ["<a@example.com>", "<b@example.com>"],
        "X-Tag": ["a", "b"]
      }
    });

    expect(lastRequest().body.headers).toEqual({
      References: "<a@example.com> <b@example.com>",
      "In-Reply-To": "<a@example.com> <b@example.com>",
      "X-Tag": "a, b"
    });
  });

  it("keeps a repeated header in the place of its first value", async () => {
    await send({
      headers: [
        { key: "X-Tag", value: "a" },
        { key: "X-Other", value: "o" },
        { key: "x-tag", value: "b" }
      ]
    });

    const { headers } = lastRequest().body;
    expect(headers).toEqual({ "X-Tag": "a, b", "X-Other": "o" });
    expect(Object.keys(headers)).toEqual(["X-Tag", "X-Other"]);
  });

  it("trims only spaces and tabs from header values", async () => {
    await send({ headers: { "X-Note": " \t note\v \t", "X-Blank": " \t " } });

    expect(lastRequest().body.headers).toEqual({ "X-Note": " note\v" });
  });
});

describe("attachments through Nodemailer", () => {
  it.each([
    ["an empty string", ""],
    ["an empty buffer", Buffer.alloc(0)]
  ])("rejects %s without calling the API", async (_label, content) => {
    await expect(send({ attachments: [{ filename: "empty.txt", content }] })).rejects.toThrow(
      new TypeError('The attachment "empty.txt" is empty.')
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects raw attachments without calling the API", async () => {
    await expect(
      send({ attachments: [{ raw: "Content-Type: text/plain\r\n\r\nx" }] })
    ).rejects.toThrow(/uses raw/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the name Nodemailer gives an attachment without a filename", async () => {
    await send({ attachments: [{ content: "x", contentType: "image/png" }] });

    expect(lastRequest().body.attachments[0]).toMatchObject({
      filename: "attachment-1.png",
      contentType: "image/png"
    });
  });

  it("measures a cid in UTF-16 code units and refuses the byte order mark", async () => {
    const fits = "\u{1F600}".repeat(127);
    const tooLong = "\u{1F600}".repeat(128);
    const withBom = "logo﻿@acme";
    await send({
      html: [fits, tooLong, withBom].map(cid => `<img src="cid:${cid}">`).join(""),
      attachments: [fits, tooLong, withBom].map(cid => ({ filename: "a.png", cid, content: "x" }))
    });

    expect(lastRequest().body.attachments.map((item: { cid?: string }) => item.cid)).toEqual([
      fits,
      undefined,
      undefined
    ]);
  });
});

describe("sending key characters", () => {
  it.each([
    ["an inner line break", "sk_te\nst"],
    ["a NUL", "sk_te\u0000st"],
    ["an inner space", "sk te"],
    ["a DEL", "sk\u007fte"],
    ["a non-ASCII character", "sk_tést"]
  ])("rejects a key with %s without echoing it", (_label, apiKey) => {
    let error: unknown;
    try {
      brudcastTransport({ auth: { apiKey } });
    } catch (caught) {
      error = caught;
    }

    expect(error).toEqual(
      new TypeError("The Brudcast sending key contains characters that are not allowed.")
    );
    expect(String((error as Error).message)).not.toContain("sk");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts every visible ASCII character", async () => {
    const apiKey = Array.from({ length: 94 }, (_, index) => String.fromCharCode(0x21 + index)).join(
      ""
    );

    await nodemailer
      .createTransport(brudcastTransport({ apiKey: ` ${apiKey}\n` }))
      .sendMail({ from: "a@example.com", to: "b@example.com", subject: "s", text: "t" });

    expect(lastRequest().init.headers.Authorization).toBe(`Bearer ${apiKey}`);
  });
});

describe("url shape and redaction", () => {
  it.each([
    "https:example.com",
    "https:/example.com",
    "https:///example.com",
    "\u0001https://example.com",
    "https://example.com\u0001",
    "https://exa\u007fmple.com",
    "https://example.com/\u0000",
    "//example.com",
    "1https://example.com"
  ])("rejects the url %j as not valid", url => {
    expect(() => createTransport({ url })).toThrow(
      new TypeError(`The Brudcast url "${url}" is not a valid URL.`)
    );
  });

  it.each([
    "http://user:S3CRET@example.com",
    "ftp://user:S3CRET@example.com",
    "https://user:S3CRET@example.com",
    "https://@example.com",
    "https://:@example.com"
  ])("rejects credentials in %j before checking the scheme, without echoing them", url => {
    expect(() => createTransport({ url })).toThrow(
      new TypeError("The Brudcast url must not include a username or password.")
    );
  });

  it.each([
    ["https://user:S3CRET@exa mple.com/path?token=abc#frag", "https://***@exa mple.com/path"],
    ["https://u:p@q@example.com:99999", "https://***@example.com:99999"],
    ["https://user:S3CRET@", "https://***@"],
    ["https:user:S3CRET@example.com", "***@example.com"],
    ["https:/user:S3CRET@example.com", "***@example.com"],
    ["https://exa mple.com/a@b", "https://***@b"],
    ["https://example.com:99999?token=abc", "https://example.com:99999"],
    ["https://example.com:99999/p#token", "https://example.com:99999/p"]
  ])("redacts the url %j in the invalid url error", (url, shown) => {
    expect(() => createTransport({ url })).toThrow(
      new TypeError(`The Brudcast url "${shown}" is not a valid URL.`)
    );
  });

  it("redacts the query string in the https error", () => {
    expect(() => createTransport({ url: "http://example.com/p?token=S3CRET#frag" })).toThrow(
      new TypeError(
        'nodemailer-brudcast-transport requires an https url, not "http://example.com/p"; set insecure to allow http'
      )
    );
  });
});

describe("Retry-After", () => {
  const rateLimited = (retryAfter?: string) =>
    new Response(JSON.stringify({ status: false, message: "Too many requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...(retryAfter === undefined ? {} : { "Retry-After": retryAfter })
      }
    });

  it.each([
    ["120", 120],
    ["0", 0],
    [" 7 ", 7]
  ])("exposes a Retry-After of %j seconds as %i", async (header, expected) => {
    fetchMock.mockResolvedValueOnce(rateLimited(header));

    await expect(send()).rejects.toMatchObject({ statusCode: 429, retryAfter: expected });
  });

  it("reads an HTTP-date as the seconds from now, rounding up", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("Sun, 06 Nov 1994 08:49:07 GMT") + 500);
    fetchMock.mockResolvedValueOnce(rateLimited("Sun, 06 Nov 1994 08:49:37 GMT"));

    await expect(send()).rejects.toMatchObject({ retryAfter: 30 });
    vi.restoreAllMocks();
  });

  it.each([
    ["an IMF-fixdate", "Wed, 21 Oct 2015 07:28:00 GMT", 80],
    ["an RFC 850 date", "Wednesday, 21-Oct-15 07:28:00 GMT", 80],
    ["an asctime date", "Wed Oct 21 07:28:00 2015", 80],
    ["an asctime date with a one-digit day", "Thu Oct  1 07:28:00 2015", 0],
    ["an IMF-fixdate with a run of spaces", "Wed,  21 Oct 2015 07:28:00 GMT", 80],
    ["the largest safe integer", "9007199254740991", Number.MAX_SAFE_INTEGER]
  ])("reads %s as the Laravel transport does", async (_label, header, expected) => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2015-10-21T07:26:40Z"));
    fetchMock.mockResolvedValueOnce(rateLimited(header));

    await expect(send()).rejects.toMatchObject({ retryAfter: expected });
    vi.restoreAllMocks();
  });

  it("reads an HTTP-date in the past as 0", async () => {
    fetchMock.mockResolvedValueOnce(rateLimited("Sun, 06 Nov 1994 08:49:37 GMT"));

    await expect(send()).rejects.toMatchObject({ retryAfter: 0 });
  });

  it.each([
    undefined,
    "",
    "soon",
    "-5",
    "1.5",
    "1e3",
    "99999999999999999999",
    "9007199254740992",
    "Sun, 06 Nov 1994 08:49:37",
    "1994-11-06T08:49:37Z",
    "Sat, 31 Feb 2015 07:28:00 GMT",
    "Wed, 21 Oct 2015 24:00:00 GMT",
    "Thu, 21 Oct 2015 07:28:00 GMT",
    "Wed, 21 Oct 2015 07:28:00 CET",
    "wed, 21 oct 2015 07:28:00 GMT",
    "Wed Oct 01 07:28:00 2015"
  ])("leaves retryAfter undefined for a header of %j", async header => {
    fetchMock.mockResolvedValueOnce(rateLimited(header));

    const error = await send().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BrudcastError);
    expect((error as BrudcastError).retryAfter).toBeUndefined();
  });

  it("exposes Retry-After when verify fails too", async () => {
    fetchMock.mockResolvedValueOnce(rateLimited("30"));

    await expect(createTransport().verify()).rejects.toMatchObject({ retryAfter: 30 });
  });

  it("leaves retryAfter undefined when the service cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));

    const error = await send().catch((caught: unknown) => caught);

    expect((error as BrudcastError).retryAfter).toBeUndefined();
  });
});

describe("Nodemailer's file and URL access flags", () => {
  const withAttachment = (attachment: Record<string, unknown>) => ({
    from: "a@example.com",
    to: "b@example.com",
    subject: "s",
    text: "t",
    attachments: [attachment]
  });

  it("reads a file attachment when the flags are not set", async () => {
    await nodemailer
      .createTransport(brudcastTransport({ apiKey: "sk_test" }))
      .sendMail(withAttachment({ path: path.join(fixtures, "hello.txt") }));

    expect(lastRequest().body.attachments[0].filename).toBe("hello.txt");
  });

  it("applies disableFileAccess given as a createTransport default", async () => {
    const transport = nodemailer.createTransport(brudcastTransport({ apiKey: "sk_test" }), {
      disableFileAccess: true
    });

    await expect(
      transport.sendMail(withAttachment({ path: path.join(fixtures, "hello.txt") }))
    ).rejects.toMatchObject({ code: "EFILEACCESS" });
    await expect(
      transport.sendMail({
        ...withAttachment({ path: path.join(fixtures, "hello.txt") }),
        disableFileAccess: false
      })
    ).rejects.toMatchObject({ code: "EFILEACCESS" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies disableUrlAccess given as a createTransport default", async () => {
    const transport = nodemailer.createTransport(brudcastTransport({ apiKey: "sk_test" }), {
      disableUrlAccess: true
    });

    await expect(
      transport.sendMail(withAttachment({ href: "https://example.com/file.txt" }))
    ).rejects.toMatchObject({ code: "EURLACCESS" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("option-derived and message ID headers", () => {
  it("rejects a list key that does not make a valid header name", async () => {
    await expect(
      send({ list: { "help\r\nBcc": "https://example.com/help" } as never })
    ).rejects.toThrow(new TypeError('The header name "list-help\r\nbcc" is not valid'));
    await expect(send({ list: { "a b": "https://example.com" } as never })).rejects.toThrow(
      /header name "list-a b" is not valid/
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("brackets custom References and In-Reply-To values however the key is cased", async () => {
    await send({
      headers: {
        REFERENCES: "a@example.com  <b@example.com>",
        "In-Reply-To": "parent@example.com"
      }
    });

    expect(lastRequest().body.headers).toEqual({
      REFERENCES: "<a@example.com> <b@example.com>",
      "In-Reply-To": "<parent@example.com>"
    });
  });

  it("brackets each value of a repeated References header", async () => {
    await send({
      headers: [
        { key: "References", value: "a@example.com" },
        { key: "references", value: "<b@example.com><c@example.com>" },
        { key: "In-Reply-To", value: "<>" }
      ]
    });

    expect(lastRequest().body.headers).toEqual({
      References: "<a@example.com> <b@example.com> <c@example.com>"
    });
  });

  it("brackets the references option as Nodemailer does", async () => {
    await send({ references: ["a@example.com", "<b@example.com> c@example.com"] });

    expect(lastRequest().body.headers).toEqual({
      references: "<a@example.com> <b@example.com> <c@example.com>"
    });
  });
});

describe("attachment content types", () => {
  it("sends a Uint8Array, a view of part of a buffer and an ArrayBuffer as bytes", async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    await send({
      attachments: [
        { filename: "a.bin", content: bytes as never },
        { filename: "b.bin", content: new Uint8Array(bytes.buffer, 1, 2) as never },
        { filename: "c.bin", content: bytes.buffer as never }
      ]
    });

    expect(lastRequest().body.attachments.map((item: { content: string }) => item.content)).toEqual(
      [
        Buffer.from(bytes).toString("base64"),
        Buffer.from([1, 2]).toString("base64"),
        Buffer.from(bytes).toString("base64")
      ]
    );
  });

  it("rejects an empty Uint8Array without calling the API", async () => {
    await expect(
      send({ attachments: [{ filename: "empty.bin", content: new Uint8Array(0) as never }] })
    ).rejects.toThrow(new TypeError('The attachment "empty.bin" is empty.'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects content of an unsupported type without calling the API", async () => {
    await expect(
      send({ attachments: [{ filename: "odd.bin", content: { value: 1 } as never }] })
    ).rejects.toThrow(
      new TypeError('The attachment "odd.bin" has content of an unsupported type.')
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("encodes text given as us-ascii", async () => {
    await send({
      attachments: [{ filename: "a.txt", content: "hello", encoding: "us-ascii" }]
    });

    expect(lastRequest().body.attachments[0].content).toBe(Buffer.from("hello").toString("base64"));
  });
});

describe("cid reference scan through Nodemailer", () => {
  it("keeps a cid of 0", async () => {
    await send({
      html: '<img src="cid:0">',
      attachments: [{ filename: "a.png", cid: "0", content: "x" }]
    });

    expect(lastRequest().body.attachments[0].cid).toBe("0");
  });
});
