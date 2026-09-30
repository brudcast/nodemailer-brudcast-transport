# Changelog

## 1.0.0 (2026-09-30)


### ⚠ BREAKING CHANGES

* http urls now throw unless insecure is true, invalid custom header names and raw attachments now throw, and the default smtp host is now smtp.brudcast.com.
* Node.js 18 is no longer supported; the minimum is Node.js 20.

### Features

* harden api transport and align with the laravel transport ([#15](https://github.com/brudcast/nodemailer-brudcast-transport/issues/15)) ([c310e17](https://github.com/brudcast/nodemailer-brudcast-transport/commit/c310e17ef3fee6bce135a2a0fc9ac76f2c955320))
* initial nodemailer transport for the brudcast mailing service ([ab74d01](https://github.com/brudcast/nodemailer-brudcast-transport/commit/ab74d01f14063529b0fc88124827cba342bb2f83))
* require node 20 ([#9](https://github.com/brudcast/nodemailer-brudcast-transport/issues/9)) ([a17b2e0](https://github.com/brudcast/nodemailer-brudcast-transport/commit/a17b2e07298318897916d04c804020edfd80325c))
* support brudcast smtp credentials ([#7](https://github.com/brudcast/nodemailer-brudcast-transport/issues/7)) ([ef7769c](https://github.com/brudcast/nodemailer-brudcast-transport/commit/ef7769cf6fdc3e9d434299f117eb77f979e9cadd))


### Bug Fixes

* join repeated custom headers into one value ([#8](https://github.com/brudcast/nodemailer-brudcast-transport/issues/8)) ([91eaae6](https://github.com/brudcast/nodemailer-brudcast-transport/commit/91eaae6e6747d6a57b3dcaabb685a94686d0bba2))
