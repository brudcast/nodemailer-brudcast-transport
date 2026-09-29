import type { AddressInfo } from "node:net";
import nodemailer from "nodemailer";
import { SMTPServer, type SMTPServerAuthentication } from "smtp-server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import brudcastTransport, {
  brudcastSmtp,
  DEFAULT_SMTP_HOST,
  DEFAULT_SMTP_PORT,
  SMTP_PORTS
} from "../src";

const auth = { user: "smtp-user", pass: "smtp-pass" };

describe("brudcastSmtp", () => {
  it("targets the production submission server over STARTTLS by default", () => {
    expect(DEFAULT_SMTP_HOST).toBe("out-smtp.prod.brudcast.com");
    expect(DEFAULT_SMTP_PORT).toBe(587);
    expect(brudcastSmtp({ auth })).toEqual({
      host: "out-smtp.prod.brudcast.com",
      port: 587,
      secure: false,
      requireTLS: true,
      auth
    });
  });

  it("lists every port the service accepts", () => {
    expect(SMTP_PORTS).toEqual({ starttls: [587, 2525, 25], implicitTls: [465] });
  });

  it.each(SMTP_PORTS.starttls)("requires STARTTLS on port %i", port => {
    expect(brudcastSmtp({ auth, port })).toMatchObject({ port, secure: false, requireTLS: true });
  });

  it("negotiates TLS on connect on port 465", () => {
    expect(brudcastSmtp({ auth, port: 465 })).toMatchObject({
      port: 465,
      secure: true,
      requireTLS: false
    });
  });

  it("passes the host, pool, timeout and tls options through", () => {
    const tls = { servername: "smtp.example.com" };

    expect(
      brudcastSmtp({ auth, host: "localhost", port: 2587, pool: true, timeout: 5000, tls })
    ).toEqual({
      host: "localhost",
      port: 2587,
      secure: false,
      requireTLS: true,
      auth,
      pool: true,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
      tls
    });
  });

  it("requires a username and password", () => {
    expect(() => brudcastSmtp({ auth: { user: "u", pass: "" } })).toThrow(/auth\.pass/);
    expect(() => brudcastSmtp(undefined as never)).toThrow(TypeError);
  });
});

describe("brudcastTransport with SMTP credentials", () => {
  it("returns SMTP options instead of the HTTP transport", () => {
    expect(brudcastTransport({ auth })).toEqual(brudcastSmtp({ auth }));
  });

  it("rejects a sending key and SMTP credentials together", () => {
    expect(() => brudcastTransport({ auth: { ...auth, apiKey: "sk" } } as never)).toThrow(
      /not both/
    );
    expect(() => brudcastTransport({ auth, apiKey: "sk" } as never)).toThrow(/not both/);
  });

  it("names both credential types when neither is given", () => {
    expect(() => brudcastTransport({})).toThrow(/auth\.apiKey.*auth\.user/);
  });
});

describe("SMTP submission", () => {
  const onAuth = vi.fn<(auth: SMTPServerAuthentication) => void>();
  const received: string[] = [];
  let server: SMTPServer;
  let port: number;

  const createTransport = (pass = auth.pass) =>
    nodemailer.createTransport(
      brudcastTransport({
        auth: { user: auth.user, pass },
        host: "127.0.0.1",
        port,
        tls: { rejectUnauthorized: false }
      })
    );

  beforeAll(async () => {
    server = new SMTPServer({
      authMethods: ["PLAIN", "LOGIN"],
      logger: false,
      onAuth(credentials, _session, callback) {
        onAuth(credentials);
        if (credentials.username === auth.user && credentials.password === auth.pass) {
          return callback(null, { user: "example.com" });
        }
        return callback(new Error("Invalid credentials"));
      },
      onData(stream, _session, callback) {
        let data = "";
        stream.on("data", chunk => (data += chunk));
        stream.on("end", () => {
          received.push(data);
          callback();
        });
      }
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    port = (server.server.address() as AddressInfo).port;
  });

  afterAll(() => new Promise<void>(resolve => server.close(resolve)));

  it("authenticates over STARTTLS and delivers the message", async () => {
    const info = await createTransport().sendMail({
      from: "hello@example.com",
      to: "customer@example.org",
      subject: "Welcome",
      text: "Thanks for signing up."
    });

    expect(onAuth).toHaveBeenLastCalledWith(
      expect.objectContaining({ username: auth.user, password: auth.pass })
    );
    expect(info.accepted).toEqual(["customer@example.org"]);
    expect(received.at(-1)).toContain("Subject: Welcome");
  });

  it("verifies the credentials", async () => {
    await expect(createTransport().verify()).resolves.toBe(true);
  });

  it("rejects a wrong password with the SMTP response code", async () => {
    await expect(createTransport("wrong").verify()).rejects.toMatchObject({
      code: "EAUTH",
      responseCode: 535
    });
  });
});
