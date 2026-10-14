# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `npm run coverage` produces the test coverage report, printing the summary
  table and writing JSON plus HTML under `coverage/`, so the numbers no longer
  require remembering the `vitest --coverage` flag.

### Fixed

- `web_research` now honors `PARALLEL_BASE_URL`. `web_search` and `web_fetch`
  already followed that variable, but research posted to
  `https://api.parallel.ai/v1/responses` regardless, so pointing the variable at
  a staging host moved two tools out of three and left research calling
  production with a key that may not be valid there. All three web tools now
  follow the same variable, and the README documents it.

## [1.0.0] - 2026-10-14

Initial release: a port of `@parallel-web/pi-extension` 1.3.0, published as
`@normful/parallel-web-pi-extension`.

### Added

- `web_search`: Parallel Search in SDK `fast` mode, sending `client_model` when
  Pi has an active model selected and a `session_id` reused for the life of the
  current Pi session.
- `web_fetch`: Parallel Extract for up to 20 URLs, returning excerpts focused on
  the objective and search queries when those are given, and whole-page markdown
  when they are not.
- `web_research`: synthesized answers with sources through the Responses API,
  with `low`, `medium` and `high` effort and follow-up questions through
  `previous_response_id`.
- A `parallel` auth provider, so Pi's own `/login parallel` runs the Parallel
  browser OAuth flow and stores the API key in Pi's `auth.json` beside every
  other provider credential.
- A `parallel-login` command reporting whether Parallel is configured and where
  the credential came from.
- Auth resolution order: the credential stored by Pi first, then
  `PARALLEL_API_KEY`.
- `PARALLEL_PLATFORM_URL`, overriding the platform endpoints used by
  `/login parallel` for local and staging auth testing.
- The package ships TypeScript source only and declares it through
  `pi.extensions`, so installation needs no build step.

## [0.0.0-stage] - 2026-10-14

A holding version containing only `package.json` and `README.md`, with no `pi`
entry and no extension source, so it registers no tools. It was replaced by
1.0.0 about a minute later.

<!-- No git tags exist for these versions yet, so the compare and tag links below
     do not resolve. Create and push v1.0.0 (and v0.0.0-stage, if wanted) to
     make them live. -->

[Unreleased]: https://github.com/normful/parallel-web-pi-extension-fork/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/normful/parallel-web-pi-extension-fork/releases/tag/v1.0.0
[0.0.0-stage]: https://github.com/normful/parallel-web-pi-extension-fork/releases/tag/v0.0.0-stage
