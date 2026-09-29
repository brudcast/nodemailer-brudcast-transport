# nodemailer-brudcast-transport

![Brudcast: Reach Everyone, Every time][banner]

[![npm version][npm-badge]][npm] [![CI][ci-badge]][ci]
[![Coverage][coverage-badge]][coverage] [![Types included][types-badge]][npm]
[![MIT license][license-badge]](LICENSE)

A [Nodemailer][nodemailer] transport for the Brudcast mailing service. It
authenticates with either kind of Brudcast credential:

- a **sending key**, delivered over the Brudcast HTTP API, which works where
  outbound SMTP ports are blocked
- **SMTP credentials**, delivered over SMTP submission to Brudcast's mail server
  on any of its [supported ports](#smtp-ports)

Either way it behaves like every other Nodemailer transport: moving an existing
app to Brudcast is a one-line change.

- **Drop-in**: the same `sendMail`, `verify`, callback and promise styles, and
  `info` shape as Nodemailer's built-in transports
- **Typed**: written in TypeScript, ships its own declarations
- **Dual package**: ESM `import` and CommonJS `require` both work
- **Broad support**: Node.js 20+ and Nodemailer 6 through 10
- **No HTTP dependencies**: uses the platform `fetch`

## Contents

- [nodemailer-brudcast-transport](#nodemailer-brudcast-transport)
  - [Contents](#contents)
  - [Installation](#installation)
  - [Quick start](#quick-start)
    - [With a sending key](#with-a-sending-key)
    - [With SMTP credentials](#with-smtp-credentials)
  - [Choosing a credential](#choosing-a-credential)
  - [Switching from another provider](#switching-from-another-provider)
    - [From SMTP](#from-smtp)
    - [From an API-key transport](#from-an-api-key-transport)
    - [Selecting the transport from configuration](#selecting-the-transport-from-configuration)
  - [Configuration](#configuration)
    - [Sending key options](#sending-key-options)
    - [SMTP options](#smtp-options)
    - [SMTP ports](#smtp-ports)
  - [Message fields](#message-fields)
  - [Result](#result)
  - [Verifying the connection](#verifying-the-connection)
  - [Error handling](#error-handling)
  - [Attachments](#attachments)
  - [Templates](#templates)
  - [TypeScript](#typescript)
  - [Compatibility](#compatibility)
  - [Contributing](#contributing)
  - [License](#license)

## Installation

Install the transport and Nodemailer with npm:

```bash
npm install nodemailer nodemailer-brudcast-transport
```

Or with pnpm:

```bash
pnpm add nodemailer nodemailer-brudcast-transport
```

Or with Yarn:

```bash
yarn add nodemailer nodemailer-brudcast-transport
```

## Quick start

### With a sending key

```ts
import nodemailer from "nodemailer";
import brudcast from "nodemailer-brudcast-transport";

const transporter = nodemailer.createTransport(
  brudcast({ auth: { apiKey: process.env.BRUDCAST_SENDING_KEY } })
);

const info = await transporter.sendMail({
  from: '"Acme" <hello@acme.com>',
  to: "customer@example.com",
  subject: "Welcome to Acme",
  text: "Thanks for signing up.",
  html: "<p>Thanks for signing up.</p>"
});

console.log(info.messageId);
```

CommonJS works the same way:

```js
const nodemailer = require("nodemailer");
const brudcast = require("nodemailer-brudcast-transport");

const transporter = nodemailer.createTransport(
  brudcast({ auth: { apiKey: process.env.BRUDCAST_SENDING_KEY } })
);
```

The `from` address must belong to a domain the sending key is allowed to use: a
domain key sends from its own domain, an organization key from any of the
organization's verified domains.

### With SMTP credentials

Pass the SMTP username and password instead of a key. The transport connects to
Brudcast's submission server on port 587 with STARTTLS; see
[SMTP ports](#smtp-ports) for the alternatives.

```ts
const transporter = nodemailer.createTransport(
  brudcast({
    auth: {
      user: process.env.BRUDCAST_SMTP_USER,
      pass: process.env.BRUDCAST_SMTP_PASS
    }
  })
);
```

SMTP credentials belong to a single sending domain, so the `from` address must
be on that domain.

## Choosing a credential

| Feature        | Sending key                        | SMTP credentials       |
| -------------- | ---------------------------------- | ---------------------- |
| Protocol       | HTTPS                              | SMTP, see [ports][p]   |
| Blocked ports  | Works                              | Needs one port open    |
| Scope          | One domain, or every org domain    | One domain             |
| `info` result  | Includes the Brudcast `jobId`      | Standard SMTP result   |
| Errors         | [`BrudcastError`](#error-handling) | SMTP `responseCode`    |
| Message fields | [Mapped subset](#message-fields)   | Everything, as MIME    |
| Pooling        | Not needed                         | Optional, `pool: true` |

[p]: #smtp-ports

Pick one per transport. Passing both a sending key and SMTP credentials throws a
`TypeError`.

## Switching from another provider

Only the `createTransport` call changes. Every `sendMail` call, callback, and
`info.messageId` lookup keeps working.

### From SMTP

Keep SMTP and swap in Brudcast SMTP credentials; the host, port and TLS settings
come from the transport:

```diff
 const transporter = nodemailer.createTransport(
-  { host: "smtp.example.com", port: 587, auth: { user, pass } }
+  brudcast({ auth: { user, pass } })
 );
```

Or move to a sending key and the HTTP API:

```diff
 const transporter = nodemailer.createTransport(
-  { host: "smtp.example.com", port: 587, auth: { user, pass } }
+  brudcast({ auth: { apiKey: process.env.BRUDCAST_SENDING_KEY } })
 );
```

### From an API-key transport

The key is read from `auth.apiKey`, `auth.api_key` or a top-level `apiKey`, so
the options object you already pass to another HTTP transport usually works
unchanged. Provider-specific options such as `domain` or `region` are ignored;
the sending domain comes from the key and the `from` address.

```diff
-import provider from "nodemailer-provider-transport";
+import brudcast from "nodemailer-brudcast-transport";

 const transporter = nodemailer.createTransport(
-  provider({ auth: { api_key: process.env.MAIL_KEY, domain: "acme.com" } })
+  brudcast({ auth: { api_key: process.env.BRUDCAST_SENDING_KEY } })
 );
```

### Selecting the transport from configuration

```ts
const transporter = nodemailer.createTransport(
  process.env.MAIL_TRANSPORT === "brudcast"
    ? brudcast({ auth: { apiKey: process.env.BRUDCAST_SENDING_KEY } })
    : { host: process.env.SMTP_HOST, port: 587, auth: { user, pass } }
);
```

## Configuration

The credential you pass decides the delivery path: `auth.apiKey` (or an alias)
selects the HTTP API, `auth.user` and `auth.pass` select SMTP.

### Sending key options

| Option         | Type     | Default   | Description                        |
| -------------- | -------- | --------- | ---------------------------------- |
| `auth.apiKey`  | `string` | -         | Brudcast sending key, **required** |
| `auth.api_key` | `string` | -         | Alias of `auth.apiKey`             |
| `apiKey`       | `string` | -         | Alias of `auth.apiKey`             |
| `url`          | `string` | See below | Base URL of the mailing service    |
| `timeout`      | `number` | `30000`   | Request timeout in milliseconds    |

`url` defaults to `https://mailing-service.brudcast.com`. Point it at another
environment when needed, for example `http://localhost:3000` locally.

### SMTP options

| Option      | Type      | Default                      | Description        |
| ----------- | --------- | ---------------------------- | ------------------ |
| `auth.user` | `string`  | -                            | SMTP username      |
| `auth.pass` | `string`  | -                            | SMTP password      |
| `host`      | `string`  | `out-smtp.prod.brudcast.com` | Submission server  |
| `port`      | `number`  | `587`                        | See [ports][p]     |
| `secure`    | `boolean` | `true` on 465, else `false`  | TLS on connect     |
| `pool`      | `boolean` | `false`                      | Reuse connections  |
| `timeout`   | `number`  | Nodemailer's defaults        | Timeouts, in ms    |
| `tls`       | `object`  | -                            | [TLS options][tls] |

`auth.user` and `auth.pass` are required. When `secure` is `false`, STARTTLS is
required. `timeout` sets the connection, greeting and socket timeouts together.

With SMTP credentials, `brudcast()` returns options for Nodemailer's built-in
SMTP transport, so everything else about it (pooling, `close()`, DSN) works as
[Nodemailer documents][smtp]. Build the same options explicitly with
`brudcastSmtp()`:

```ts
import { brudcastSmtp } from "nodemailer-brudcast-transport";

const transporter = nodemailer.createTransport(
  brudcastSmtp({ auth: { user, pass }, port: 465, pool: true })
);
```

### SMTP ports

Every port requires TLS. The transport never falls back to plaintext: if the
server does not offer STARTTLS, the send fails.

| Port   | TLS      | Use it when                                          |
| ------ | -------- | ---------------------------------------------------- |
| `587`  | STARTTLS | Default; the standard submission port                |
| `2525` | STARTTLS | Your host or network blocks 587, common on cloud VMs |
| `25`   | STARTTLS | Only 25 is open; many ISPs and clouds block it       |
| `465`  | Implicit | You want TLS from the first byte                     |

```ts
brudcast({ auth: { user, pass }, port: 2525 });
brudcast({ auth: { user, pass }, port: 465 }); // secure: true is implied
```

The list is also exported as `SMTP_PORTS`.

Keep sending keys and SMTP passwords out of source control; load them from the
environment or a secret manager.

## Message fields

This section, [Result](#result) and [Error handling](#error-handling) describe
the sending-key path. Over SMTP, Nodemailer composes and sends the complete MIME
message, so every [message field][message] is supported.

The transport accepts the standard [Nodemailer message fields][message].
Addresses may be strings (`"Name <a@b.com>"`), address objects, or arrays of
either.

| Field                           | Sent                              |
| ------------------------------- | --------------------------------- |
| `from`                          | Yes                               |
| `to`, `cc`, `bcc`               | Yes                               |
| `replyTo`                       | Yes, the first address            |
| `subject`                       | Yes                               |
| `text`, `html`                  | Yes, at least one is required     |
| `attachments`                   | Yes, see [below](#attachments)    |
| `headers`                       | Yes, as string values             |
| `template`                      | Rendered, see [below](#templates) |
| `sender`, `amp`, `watchHtml`    | No                                |
| `icalEvent`, `alternatives`     | No                                |
| `list`                          | No                                |
| `envelope`, `dkim`, `messageId` | No, Brudcast sets these           |

Repeated headers, such as an array of values, are joined into one
comma-separated value. Brudcast builds the SMTP envelope, signs with the
domain's DKIM key and assigns the Message-ID itself.

## Result

`sendMail` resolves once Brudcast has queued the message (HTTP `202`). The
`info` object follows Nodemailer's conventions:

```ts
{
  // Message-ID of the delivered email
  messageId: "<5f0c...@brudcast-mailing-service>",
  envelope: { from: "hello@acme.com", to: ["customer@example.com"] },
  accepted: ["customer@example.com"],
  rejected: [],
  pending: [],
  response: "202 Email queued for delivery",
  // Brudcast job id, for support and delivery logs
  jobId: "5f0c..."
}
```

Because delivery is queued, `accepted` means accepted for delivery by Brudcast,
not by the recipient's mail server. Bounces and suppressions are reported
through Brudcast delivery events.

Over SMTP, `info` is Nodemailer's standard SMTP result, with no `jobId`. The
same caveat applies: `250` means queued by Brudcast, not delivered.

## Verifying the connection

```ts
await transporter.verify(); // true, or rejects if the key is not accepted
```

`verify` checks that the service is reachable and that it accepts the sending
key, without sending an email. With SMTP credentials it connects, upgrades to
TLS and authenticates. It supports the callback style too.

## Error handling

Failed sends reject with a `BrudcastError`:

```ts
import { BrudcastError } from "nodemailer-brudcast-transport";

try {
  await transporter.sendMail(message);
} catch (error) {
  if (error instanceof BrudcastError) {
    error.statusCode; // HTTP status, e.g. 400, 401, 422, 429
    error.message; // the service's message
    error.errors; // validation issues for a 422
    error.response; // the full response body
  }
  throw error;
}
```

| Status | Meaning                                            |
| ------ | -------------------------------------------------- |
| `400`  | The `from` domain is not registered or not allowed |
| `401`  | The sending key is missing, unknown or revoked     |
| `403`  | Sending is blocked for the domain or organization  |
| `422`  | The message failed validation; see `error.errors`  |
| `429`  | Rate limited; retry with backoff                   |
| `5xx`  | Service unavailable; safe to retry                 |

Network failures and timeouts reject with the underlying `fetch` error
(`TimeoutError` when `timeout` elapses).

Over SMTP, failures reject with Nodemailer's SMTP errors, which carry `code` and
the server's `responseCode`:

| Code  | Meaning                                                          |
| ----- | ---------------------------------------------------------------- |
| `535` | The username or password is wrong, or the user is inactive       |
| `550` | `from` is off the user's domain, unregistered, or sending is off |
| `451` | Rate limited; retry with backoff                                 |

## Attachments

Every Nodemailer attachment source works: `content` as a string or `Buffer`,
`path`, `href` and streams. Nodemailer resolves them and the transport sends
each one base64 encoded.

```ts
attachments: [
  { filename: "invoice.pdf", path: "./invoices/1042.pdf" },
  { filename: "report.csv", content: csvBuffer },
  { filename: "note.txt", content: "aGVsbG8=", encoding: "base64" }
];
```

Attachments with a `cid` are delivered inline, so the HTML can show them with
`<img src="cid:...">`.

## Templates

Templates are rendered on the sending-key path only; with SMTP credentials, use
a Nodemailer [plugin][plugins] or render `html` yourself.

Set `template` to render HTML locally with any engine supported by
[Consolidate.js][consolidate]. Install the engine itself alongside.

```ts
await transporter.sendMail({
  from: "hello@acme.com",
  to: "customer@example.com",
  subject: "Welcome",
  template: {
    name: "emails/welcome.hbs",
    engine: "handlebars",
    context: { firstName: "Mary" }
  }
});
```

An explicit `html` field always takes precedence over `template`.

## TypeScript

Types ship with the package. With Nodemailer 10's bundled types, `info` is
inferred as `BrudcastSentMessageInfo`:

```ts
const info = await transporter.sendMail(message);
info.jobId; // string
```

With SMTP credentials, `brudcast()` returns `BrudcastSmtpTransportOptions`,
which `createTransport` types as an SMTP transport.

On Nodemailer 6 to 9 with `@types/nodemailer`, every custom transport's result
is typed as the SMTP result. The standard fields (`messageId`, `envelope`,
`accepted`, ...) type-check as usual; cast when you need `jobId`:

```ts
import type { BrudcastSentMessageInfo } from "nodemailer-brudcast-transport";

const info = await transporter.sendMail(message);
const { jobId } = info as BrudcastSentMessageInfo;
```

## Compatibility

| Dependency | Supported      |
| ---------- | -------------- |
| Node.js    | 20, 22, 24     |
| Nodemailer | 6, 7, 8, 9, 10 |

CI runs the suite on every listed Node.js version and against every listed
Nodemailer major.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as
described in [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Brudcast Limited

[banner]: .github/assets/banner.svg
[npm]: https://www.npmjs.com/package/nodemailer-brudcast-transport
[npm-badge]:
  https://img.shields.io/npm/v/nodemailer-brudcast-transport?color=365AED&label=npm
[ci]:
  https://github.com/brudcast/nodemailer-brudcast-transport/actions/workflows/ci.yml
[ci-badge]:
  https://img.shields.io/github/actions/workflow/status/brudcast/nodemailer-brudcast-transport/ci.yml?branch=main&label=CI
[coverage]: https://codecov.io/gh/brudcast/nodemailer-brudcast-transport
[coverage-badge]:
  https://img.shields.io/codecov/c/github/brudcast/nodemailer-brudcast-transport?color=16A34A
[types-badge]:
  https://img.shields.io/npm/types/nodemailer-brudcast-transport?color=365AED
[license-badge]:
  https://img.shields.io/npm/l/nodemailer-brudcast-transport?color=131313
[nodemailer]: https://nodemailer.com
[message]: https://nodemailer.com/message/
[consolidate]: https://github.com/ladjs/consolidate
[smtp]: https://nodemailer.com/smtp/
[plugins]: https://nodemailer.com/plugins/
[tls]: https://nodejs.org/api/tls.html#tlsconnectoptions-callback
