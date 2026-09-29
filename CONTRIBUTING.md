# Contributing

## Setup

```bash
nvm use
npm ci
```

## Scripts

| Script                  | What it does                                 |
| ----------------------- | -------------------------------------------- |
| `npm test`              | Run the unit tests                           |
| `npm run test:coverage` | Run the tests with coverage thresholds       |
| `npm run lint`          | Lint TypeScript and Markdown                 |
| `npm run format`        | Format with Prettier                         |
| `npm run typecheck`     | Type-check without emitting                  |
| `npm run build`         | Build ESM, CommonJS and types into `dist/`   |
| `npm run test:dist`     | Smoke-test the build from `require`/`import` |
| `npm run check:package` | Validate `package.json` exports and types    |

## Commits and releases

Commits and pull request titles follow [Conventional Commits][conventional].
Releases are cut by [release-please][release-please]: merging to `main` opens or
updates a release pull request, and merging that pull request tags the release,
updates `CHANGELOG.md` and publishes to npm with provenance.

- `fix:` releases a patch
- `feat:` releases a minor
- `feat!:` or a `BREAKING CHANGE:` footer releases a major

## Compatibility

The transport must stay a drop-in Nodemailer transport. CI runs the suite
against every supported Nodemailer major; keep `sendMail`, `verify`, and the
`info` shape consistent with Nodemailer's own transports.

[conventional]: https://www.conventionalcommits.org
[release-please]: https://github.com/googleapis/release-please
