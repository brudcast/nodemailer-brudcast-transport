import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import brudcast, { brudcastTransport, BrudcastError } from "nodemailer-brudcast-transport";
import { brudcastSmtp, SMTP_PORTS } from "nodemailer-brudcast-transport";

assert.equal(brudcast, brudcastTransport);
assert.equal(typeof BrudcastError, "function");
assert.equal(nodemailer.createTransport(brudcast({ auth: { apiKey: "sk" } })).transporter.name, "Brudcast");
assert.equal(nodemailer.createTransport(brudcastSmtp({ auth: { user: "u", pass: "p" } })).transporter.name, "SMTP");
assert.deepEqual(SMTP_PORTS.starttls, [587, 2525, 25]);
console.log("esm ok");
