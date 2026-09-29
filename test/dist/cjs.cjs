const assert = require("node:assert/strict");
const brudcast = require("../..");
const { brudcastTransport, brudcastSmtp, BrudcastError, SMTP_PORTS } = require("../..");

assert.equal(typeof brudcast, "function");
assert.equal(brudcast, brudcastTransport);
assert.equal(brudcast.default, brudcast);
assert.equal(typeof BrudcastError, "function");
assert.equal(brudcast({ auth: { apiKey: "sk" } }).name, "Brudcast");
assert.deepEqual(brudcast({ auth: { user: "u", pass: "p" } }), brudcastSmtp({ auth: { user: "u", pass: "p" } }));
assert.deepEqual(SMTP_PORTS.implicitTls, [465]);
console.log("cjs ok");
