# nodemailer-brudcast-transport

![Send through Brudcast from any Nodemailer app][banner]

[![npm version][npm-badge]][npm] [![CI][ci-badge]][ci]
[![Coverage][coverage-badge]][coverage] [![Types included][types-badge]][npm]
[![MIT license][license-badge]](LICENSE)

A [Nodemailer][nodemailer] transport for the Brudcast mailing service. It sends
over the Brudcast HTTP API instead of SMTP, so it works where outbound SMTP
ports are blocked, and it behaves like every other Nodemailer transport: moving
an existing app to Brudcast is a one-line change.

- **Drop-in**: the same `sendMail`, `verify`, callback and promise styles, and
  `info` shape as Nodemailer's built-in transports
- **Typed**: written in TypeScript, ships its own declarations
- **Dual package**: ESM `import` and CommonJS `require` both work
- **Broad support**: Node.js 18+ and Nodemailer 6 through 10
- **No HTTP dependencies**: uses the platform `fetch`

## Contents

- [nodemailer-brudcast-transport](#nodemailer-brudcast-transport)
  - [Contents](#contents)
  - [Installation](#installation)
  - [Quick start](#quick-start)
  - [Switching from another provider](#switching-from-another-provider)
    - [From SMTP](#from-smtp)
    - [From an API-key transport](#from-an-api-key-transport)
    - [Selecting the transport from configuration](#selecting-the-transport-from-configuration)
  - [Configuration](#configuration)
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

```bash
npm install nodemailer nodemailer-brudcast-transport
```

```bash
pnpm add nodemailer nodemailer-brudcast-transport
yarn add nodemailer nodemailer-brudcast-transport
```

## Quick start

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

## Switching from another provider

Only the `createTransport` call changes. Every `sendMail` call, callback, and
`info.messageId` lookup keeps working.

### From SMTP

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

| Option         | Type     | Default   | Description                        |
| -------------- | -------- | --------- | ---------------------------------- |
| `auth.apiKey`  | `string` | -         | Brudcast sending key, **required** |
| `auth.api_key` | `string` | -         | Alias of `auth.apiKey`             |
| `apiKey`       | `string` | -         | Alias of `auth.apiKey`             |
| `url`          | `string` | See below | Base URL of the mailing service    |
| `timeout`      | `number` | `30000`   | Request timeout in milliseconds    |

`url` defaults to `https://mailing-service.brudcast.com`. Point it at another
environment when needed, for example `http://localhost:3000` locally.

Keep sending keys out of source control; load them from the environment or a
secret manager.

## Message fields

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

Brudcast builds the SMTP envelope, signs with the domain's DKIM key and assigns
the Message-ID itself.

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

## Verifying the connection

```ts
await transporter.verify(); // true, or rejects if the key is not accepted
```

`verify` checks that the service is reachable and that it accepts the sending
key, without sending an email. It supports the callback style too.

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

Inline images referenced by `cid` are delivered as regular attachments; host
images and link to them for inline display.

## Templates

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
| Node.js    | 18, 20, 22, 24 |
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
