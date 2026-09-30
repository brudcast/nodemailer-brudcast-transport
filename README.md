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

## Features

- **Drop-in**: the same `sendMail`, `verify`, callback and promise styles, and
  `info` shape as Nodemailer's built-in transports
- **Typed**: written in TypeScript, ships its own declarations
- **Dual package**: ESM `import` and CommonJS `require` both work
- **Broad support**: Node.js 20+ and Nodemailer 6 through 10
- **No HTTP dependencies**: uses the platform `fetch`

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick start](#quick-start)
  - [With a sending key](#with-a-sending-key)
  - [With SMTP credentials](#with-smtp-credentials)
- [Choosing a credential](#choosing-a-credential)
- [Configuration](#configuration)
  - [Sending key options](#sending-key-options)
  - [SMTP options](#smtp-options)
  - [SMTP ports](#smtp-ports)
  - [Migrating from another provider](#migrating-from-another-provider)
- [Usage](#usage)
  - [Message fields](#message-fields)
  - [Result](#result)
  - [Verifying the connection](#verifying-the-connection)
  - [Error handling](#error-handling)
  - [Attachments](#attachments)
  - [Templates](#templates)
  - [TypeScript](#typescript)
  - [Exports](#exports)
- [Compatibility](#compatibility)
- [Testing](#testing)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [Security Vulnerabilities](#security-vulnerabilities)
- [Support](#support)
- [Credits](#credits)
- [License](#license)

## Requirements

- Node.js 20 or later
- Nodemailer 6 or later

You also need Brudcast credentials for a verified domain: a sending key, or SMTP
credentials.

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

## Configuration

The credential you pass decides the delivery path: `auth.apiKey` (or an alias)
selects the HTTP API, `auth.user` and `auth.pass` select SMTP.

### Sending key options

| Option         | Type      | Default   | Description                        |
| -------------- | --------- | --------- | ---------------------------------- |
| `auth.apiKey`  | `string`  | -         | Brudcast sending key, **required** |
| `auth.api_key` | `string`  | -         | Alias of `auth.apiKey`             |
| `apiKey`       | `string`  | -         | Alias of `auth.apiKey`             |
| `url`          | `string`  | See below | Base URL of the mailing service    |
| `insecure`     | `boolean` | `false`   | Allow `http://` urls               |
| `timeout`      | `number`  | `30000`   | Request timeout in milliseconds    |

`url` defaults to `https://mailing-service.brudcast.com`, and most applications
never need to change it; an empty string or `null` also selects the default. The
send path is appended to any path the url has, so a prefix such as
`https://proxy.example.com/brudcast` is kept, and any query string or fragment
is dropped.

The url is checked when the transport is created, and an invalid one throws a
`TypeError`. It must start with a scheme and `://`, such as `https://`, have a
host, and must not contain a username or password, whitespace, a backslash or a
control character; it is not trimmed or cleaned up, so `https:example.com` and
`https:///example.com` are refused. Ports that `fetch` refuses to connect to,
such as 25 and 6000, cannot be used.

An error message that quotes the url never shows credentials: anything between
`://` and an `@` is replaced with `***`, and the query string and fragment are
left out. A url with a username or password is refused before its scheme is
checked, with a message that does not quote it.

Because the sending key is sent in the `Authorization` header, `url` must use
HTTPS. An `http://` url throws a `TypeError` when the transport is created,
unless `insecure` is `true`, for example to reach a local or Docker-networked
mailing service:

```ts
brudcast({
  auth: { apiKey: process.env.BRUDCAST_SENDING_KEY },
  url: "http://mailing-service:3000",
  insecure: true
});
```

<!-- prettier-ignore -->
> [!WARNING]
> `insecure` sends the sending key unencrypted. Never enable it in production.

`insecure` is on for `true`, `1`, or a string such as `"true"`, `"1"`, `"on"` or
`"yes"` in any case, so it can be read straight from an environment variable.
Anything else leaves it off.

Redirects are not followed. If the url responds with a redirect, the send fails
and the error message includes the target URL; set `url` to that URL.

`timeout` covers the whole request, connecting included; there is no separate
connection timeout. It may be a number or a numeric string of digits with an
optional fraction, such as `"5000"` or `" 2500.5 "` (ASCII whitespace around it
is allowed; `"1e3"`, `".5"` and `"+5"` are not). A fraction is rounded up to a
whole millisecond, and the result must be from 1 to 2147483647 (about 24.8
days), the longest delay a timer supports. Anything else throws a `TypeError`
when the transport is created; a timeout that is too long is refused, not
shortened:

```text
The Brudcast timeout must be a positive number of milliseconds no greater than 2147483647.
```

The key is read from `auth.apiKey`, then `auth.api_key`, then `apiKey`, skipping
any that is not a string or is blank. Surrounding ASCII whitespace, such as a
trailing newline from a secret store, is removed. What is left must be visible
ASCII only (`!` to `~`): a key with any other character, such as an inner space
or line break, throws
`The Brudcast sending key contains characters that are not allowed.` when the
transport is created. No error message ever quotes the key.

Nodemailer's `disableFileAccess` and `disableUrlAccess` apply to this transport
only when passed as defaults, the second argument of `createTransport`; setting
them in the options given to `brudcast()` has no effect:

```ts
const transporter = nodemailer.createTransport(
  brudcast({ auth: { apiKey: process.env.BRUDCAST_SENDING_KEY } }),
  { disableFileAccess: true, disableUrlAccess: true }
);
```

With them set, an attachment with a `path` or an `href` fails the send before
any request is made, and a message cannot switch them back off.

### SMTP options

| Option      | Type      | Default                     | Description        |
| ----------- | --------- | --------------------------- | ------------------ |
| `auth.user` | `string`  | -                           | SMTP username      |
| `auth.pass` | `string`  | -                           | SMTP password      |
| `host`      | `string`  | `smtp.brudcast.com`         | Submission server  |
| `port`      | `number`  | `587`                       | See [ports][p]     |
| `secure`    | `boolean` | `true` on 465, else `false` | TLS on connect     |
| `pool`      | `boolean` | `false`                     | Reuse connections  |
| `timeout`   | `number`  | Nodemailer's defaults       | Timeouts, in ms    |
| `tls`       | `object`  | -                           | [TLS options][tls] |

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

The ports are also exported as `SMTP_PORTS`, an object with a `starttls` list
(`[587, 2525, 25]`) and an `implicitTls` list (`[465]`).

Keep sending keys and SMTP passwords out of source control; load them from the
environment or a secret manager.

### Migrating from another provider

Only the `createTransport` call changes. Every `sendMail` call, callback, and
`info.messageId` lookup keeps working.

#### From SMTP

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

#### From an API-key transport

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

#### Selecting the transport from configuration

```ts
const transporter = nodemailer.createTransport(
  process.env.MAIL_TRANSPORT === "brudcast"
    ? brudcast({ auth: { apiKey: process.env.BRUDCAST_SENDING_KEY } })
    : { host: process.env.SMTP_HOST, port: 587, auth: { user, pass } }
);
```

## Usage

### Message fields

This section, [Result](#result) and [Error handling](#error-handling) describe
the sending-key path. Over SMTP, Nodemailer composes and sends the complete MIME
message, so every [message field][message] is supported.

The transport accepts the standard [Nodemailer message fields][message].
Addresses may be strings (`"Name <a@b.com>"`), address objects, or arrays of
either.

| Field                       | Sent                              |
| --------------------------- | --------------------------------- |
| `from`                      | Yes, every address                |
| `to`, `cc`, `bcc`           | Yes                               |
| `replyTo`                   | Yes, every address                |
| `subject`                   | Yes                               |
| `text`, `html`              | Yes, at least one is required     |
| `attachments`               | Yes, see [below](#attachments)    |
| `headers`                   | Yes, see below                    |
| `template`                  | Rendered, see [below](#templates) |
| `inReplyTo`, `references`   | Yes, as headers                   |
| `list`                      | Yes, as `List-*` headers          |
| `sender`                    | No, set for several `from`        |
| `amp`, `watchHtml`          | No                                |
| `icalEvent`, `alternatives` | No                                |
| `priority`                  | Yes, as headers, see below        |
| `xMailer`                   | Yes, as the `X-Mailer` header     |
| `envelope`                  | Its recipients, see below         |
| `dkim`, `messageId`         | No, Brudcast sets these           |

Every `from` address is sent. When there is more than one, Brudcast lists them
all in the `From` header and sets the `Sender` header to the first, as RFC 5322
requires, and every address must be on the first one's domain.

Address groups such as `Team: ann@acme.com, bob@acme.com;` are sent as their
members. Display names have line breaks removed and surrounding whitespace
trimmed, and a blank name is left out. Brudcast encodes a non-ASCII display name
as one whole value, so encode it yourself (RFC 2047, for example
`=?UTF-8?B?...?=`) if the recipient's mail client must show it exactly.

The envelope decides who receives the message, and by default it holds every
`to`, `cc` and `bcc` address:

- `to` is every envelope recipient in the `to` field, named as there, then every
  envelope recipient in none of `to`, `cc` and `bcc`, in envelope order. An
  address in `to` that is also in `cc` or `bcc` stays in `to`.
- `cc` and `bcc` are the addresses in those fields that are envelope recipients.
- Each list keeps the first of each address, compared case-insensitively.

The envelope sender is not sent, since Brudcast sets the Return-Path for bounce
handling. Every message needs at least one `to` recipient, so a message with
only `bcc` recipients fails validation.

Numbers in `headers` are sent as text, line breaks in a value become spaces, and
spaces and tabs are trimmed from both ends; a header left empty is skipped.
Headers Brudcast sets itself or reads from the fields above (`From`, `Sender`,
`To`, `Cc`, `Bcc`, `Reply-To`, `Subject`, `Date`, `Message-ID`, `Content-Type`
and similar) are left out. A header name that is not printable ASCII without a
colon fails the send before the request is made, and so does a `list` key that
does not make such a name.

Header names are matched case-insensitively: repeated headers, such as an array
of values or the same name in two cases, are joined into one value under the
first spelling, in the first one's place. Values are joined with a comma, except
`References` and `In-Reply-To`, which are joined with a space. `References` and
`In-Reply-To` are then written as Nodemailer writes `References`, whatever the
case of the name and whether given as one value or several: the value is split
on whitespace and angle brackets, and each message ID is put in angle brackets,
separated by a space, so `a@example.com b@example.com` is sent as
`<a@example.com> <b@example.com>`; one left with no ID is skipped. Brudcast
accepts header names of up to 78 characters and values of up to 998, so a very
long combined value fails validation with a `422`. Brudcast signs with the
domain's DKIM key and assigns the Message-ID itself.

The headers Nodemailer builds from message fields replace a custom header of the
same name, in any case, keeping its spelling and place:

- `inReplyTo` and `references` as `In-Reply-To` and `References`
- `list` as the `List-*` headers
- `xMailer` as `X-Mailer`, only when set; like Nodemailer, the transport sends
  no `X-Mailer` by default
- a `priority` of `high` as `X-Priority: 1 (Highest)`, `X-MSMail-Priority: High`
  and `Importance: High`, and `low` as `X-Priority: 5 (Lowest)`,
  `X-MSMail-Priority: Low` and `Importance: Low`; `normal` adds none

### Result

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

### Verifying the connection

```ts
await transporter.verify(); // true, or rejects if the key is not accepted
```

`verify` checks that the service is reachable and that it accepts the sending
key, without sending an email. It posts an empty message and passes only on the
service's own validation response: a `422` with a JSON body whose `status` is
`false` and `errors` is a list. Any other response rejects with a
`BrudcastError`, so a `422` from a proxy in front of Brudcast does not pass.

`verify` does not check the sending domain: a key whose domain is not registered
(`400`) or is blocked (`403`) still passes, and fails on the first send.

With SMTP credentials it connects, upgrades to TLS and authenticates. It
supports the callback style too.

### Error handling

A send or `verify` that reaches the service and is refused rejects with a
`BrudcastError`, and so does one that cannot reach it:

```ts
import { BrudcastError } from "nodemailer-brudcast-transport";

try {
  await transporter.sendMail(message);
} catch (error) {
  if (error instanceof BrudcastError) {
    error.statusCode; // HTTP status, e.g. 400, 401, 422, 429, or 0
    error.message; // the service's message
    error.errors; // validation issues for a 422, always a list
    error.response; // the full response body
    error.cause; // the network error, when statusCode is 0
    error.retryAfter; // seconds from the Retry-After header, or undefined
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
| `429`  | Rate limited; back off before retrying             |
| `5xx`  | Service error; see below before retrying           |
| `0`    | The service could not be reached, or timed out     |

`error.message` is the service's message when it sends one, otherwise
`Brudcast responded with HTTP <status>`. A network failure or timeout has
`statusCode` 0, the message
`Could not reach the Brudcast mailing service: <reason>`, and the original
`fetch` error (a `TimeoutError` when `timeout` elapses) as `error.cause`.

On a `429`, back off before retrying; when the response carries `Retry-After`,
it is exposed as `error.retryAfter`, in seconds. Both forms of the header are
read, as the Laravel transport reads them: a number of seconds up to
`Number.MAX_SAFE_INTEGER`, and an HTTP-date such as
`Wed, 21 Oct 2026 07:28:00 GMT` (or the obsolete RFC 850 and asctime forms),
counted from now and never below 0. A header that is absent or neither of those,
including a date that does not exist or names the wrong weekday, leaves
`retryAfter` undefined, and so does a failure to reach the service. A `5xx` is
not always worth retrying: Brudcast also answers `500` when the request body is
not valid JSON or is larger than 10 MB. And a `5xx` or a timeout does not always
mean the message was not queued: a proxy in front of Brudcast can time out after
the service has accepted it. Retrying in that case sends the message a second
time.

Some mistakes are caught before any request is made, and throw a plain error
rather than a `BrudcastError`. Invalid options, such as a missing key, both
kinds of credential, or an invalid `url`, `insecure` or `timeout`, throw when
the transport is created; the rest reject the send:

| Error       | Cause                                                     |
| ----------- | --------------------------------------------------------- |
| `TypeError` | Invalid options, when the transport is created            |
| `TypeError` | A header name that is not printable ASCII without a colon |
| `TypeError` | A `list` key that does not make such a header name        |
| `TypeError` | A `raw` attachment                                        |
| `TypeError` | An attachment with empty content                          |
| `TypeError` | An attachment whose content is an unsupported object      |
| `Error`     | A `template` whose engine Consolidate.js does not support |

Over SMTP, failures reject with Nodemailer's SMTP errors, which carry `code` and
the server's `responseCode`:

| Code  | Meaning                                                          |
| ----- | ---------------------------------------------------------------- |
| `535` | `Authentication failed`: wrong username or password, or inactive |
| `550` | `from` is off the user's domain, unregistered, or sending is off |
| `451` | Rate limited; retry with backoff                                 |
| `451` | `Failed to queue message`: a temporary failure; retry later      |

### Attachments

Every Nodemailer attachment source works: `content` as a string, a `Buffer`, a
`Uint8Array` or other `ArrayBuffer` view, or an `ArrayBuffer`, `path`, `href`
and streams. Nodemailer resolves them and the transport sends each one base64
encoded; binary content is sent as its bytes. String content is read in its
`encoding`, matched case-insensitively: `utf-8` or `utf8` (the default),
`us-ascii` or `ascii`, `base64`, `hex`, and `binary` or `latin1`; any other name
is read as UTF-8. `raw` attachments are not supported and fail the send; use
SMTP credentials to send them. An attachment with empty content fails the send
too, with `The attachment "<filename>" is empty.`, and one whose content is any
other kind of object fails with
`The attachment "<filename>" has content of an unsupported type.`, both before
any request is made. One without a `filename` is named as Nodemailer names it,
from the path or URL it was read from, or `attachment-<n>.<ext>` from its
position and content type, using Nodemailer's table of extensions.

```ts
attachments: [
  { filename: "invoice.pdf", path: "./invoices/1042.pdf" },
  { filename: "report.csv", content: csvBuffer },
  { filename: "note.txt", content: "aGVsbG8=", encoding: "base64" }
];
```

An attachment whose `cid` the HTML references, in an image `src` or a
`background`, is delivered inline so `<img src="cid:...">` shows it. One with a
`cid` the HTML does not reference is sent as a regular attachment, and so is one
Brudcast cannot use as a content ID: one containing whitespace or angle
brackets, or longer than 255 UTF-16 code units. References are looked for within
the first 4000 characters of a tag's attributes, and the scan takes linear time,
so hostile HTML cannot stall the event loop.

### Templates

Templates are rendered on the sending-key path only; with SMTP credentials, use
a Nodemailer [plugin][plugins] or render `html` yourself.

Set `template` to render HTML locally with any engine supported by
[Consolidate.js][consolidate]. Install the engine itself alongside.

```ts
import type { SendMailOptions } from "nodemailer";
import type { BrudcastSendMailOptions } from "nodemailer-brudcast-transport";

const message: SendMailOptions & BrudcastSendMailOptions = {
  from: "hello@acme.com",
  to: "customer@example.com",
  subject: "Welcome",
  template: {
    name: "emails/welcome.hbs",
    engine: "handlebars",
    context: { firstName: "Mary" }
  }
};

await transporter.sendMail(message);
```

`template` is not one of Nodemailer's own fields, so its types reject it in an
inline object; declaring the message with `BrudcastSendMailOptions` adds it. An
explicit `html` field always takes precedence over `template`. An engine that
Consolidate.js does not support throws `Unsupported template engine "<name>"`.

### TypeScript

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

### Exports

Besides the default export, the package exports:

| Export              | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `brudcastTransport` | The default export, by name                            |
| `brudcastSmtp`      | Builds SMTP options, see [SMTP options](#smtp-options) |
| `BrudcastError`     | The error a refused or failed request rejects with     |
| `buildPayload`      | Converts a normalized message to the request body      |
| `DEFAULT_URL`       | `https://mailing-service.brudcast.com`                 |
| `SEND_PATH`         | `/api/v1/send`, appended to `url`                      |
| `DEFAULT_TIMEOUT`   | `30000`, the request timeout in milliseconds           |
| `MESSAGE_ID_DOMAIN` | `brudcast-mailing-service`, the domain of `messageId`  |
| `DEFAULT_SMTP_HOST` | `smtp.brudcast.com`                                    |
| `DEFAULT_SMTP_PORT` | `587`                                                  |
| `SMTP_PORTS`        | `{ starttls: [587, 2525, 25], implicitTls: [465] }`    |

`buildPayload` takes the data Nodemailer passes to a transport's `normalize`
callback and resolves to the JSON body the transport posts, which is useful to
inspect or log what would be sent. The types, including `BrudcastSendPayload`,
`BrudcastTransportOptions` and `BrudcastSmtpOptions`, are exported too.

## Compatibility

| Dependency | Supported      |
| ---------- | -------------- |
| Node.js    | 20, 22, 24     |
| Nodemailer | 6, 7, 8, 9, 10 |

CI runs the suite on every listed Node.js version and against every listed
Nodemailer major.

## Testing

```bash
npm test
```

To type-check, lint and check formatting:

```bash
npm run typecheck
npm run lint
npm run format:check
```

[CONTRIBUTING](CONTRIBUTING.md) lists every script.

## Changelog

See the [releases][releases] for what has changed in each release.

## Contributing

Please see [CONTRIBUTING](CONTRIBUTING.md) for the development setup, available
scripts and commit conventions.

## Security Vulnerabilities

Please do not report security vulnerabilities through public issues. See
[SECURITY](SECURITY.md) for how to report them privately.

## Support

Found a bug or have a feature request? [Open an issue][issues]. Please include
the package, Node.js and Nodemailer versions, and never paste a live sending key
or SMTP password.

## Credits

- [Brudcast Limited][brudcast]
- [All contributors][contributors]

## License

The MIT License (MIT). Please see the [License File](LICENSE) for more
information.

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
[releases]: https://github.com/brudcast/nodemailer-brudcast-transport/releases
[issues]: https://github.com/brudcast/nodemailer-brudcast-transport/issues
[brudcast]: https://github.com/brudcast
[contributors]:
  https://github.com/brudcast/nodemailer-brudcast-transport/graphs/contributors
[nodemailer]: https://nodemailer.com
[message]: https://nodemailer.com/message/
[consolidate]: https://github.com/ladjs/consolidate
[smtp]: https://nodemailer.com/smtp/
[plugins]: https://nodemailer.com/plugins/
[tls]: https://nodejs.org/api/tls.html#tlsconnectoptions-callback
