# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/2.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.1.2] - 2026-10-15

### Changed

- The prompt text the three web tools contribute is now about a quarter of its
  previous size: 3,057 characters to 756, plus the routing block the extension
  appends to the system prompt, 727 to 435. Pi reads four surfaces per tool —
  the description and parameter descriptions in the tool schema, `promptSnippet`
  in its `<tools>` section, `promptGuidelines` in `<rules>` — and this extension
  adds a fifth, so the same instruction was reaching the model two to four
  times. Each surface now owns one dimension: the routing block says when to
  reach for a tool, the description what the tool does and what it costs, the
  snippet the shape of what comes back, and each parameter its own constraint.
- `web_search`, `web_fetch` and `web_research` no longer name Parallel in
  anything the model reads, so the model reports web search, web fetch and web
  research rather than naming the backend. The `parallel-login` command and its
  status messages still name the provider, because `/login parallel` and
  `PARALLEL_API_KEY` are literals you type.
- `web_research` now describes what the tool does — multi-step web searches,
  live page fetches, source cross-checks — and how long it takes, about 5–60
  seconds. Neither fact appeared anywhere the model could read before, and the
  previous description spent its whole length on what the tool returns, which
  its snippet already said.

## [1.1.1] - 2026-10-14

### Fixed

- `typebox` moved from `dependencies` to `peerDependencies` with a `"*"` range.
  Pi supplies `typebox` to extensions from its own module graph, so the declared
  dependency made npm install a second physical copy of the package under the
  extension. Pi reports that as a startup warning ("Host-provided extension
  packages must be declared in peerDependencies"), and beyond the warning the
  duplicate copy could let the extension build tool schemas with one typebox
  instance while Pi validates them with another. `typebox` stays in
  `devDependencies` so local typechecking still resolves it.

## [1.1.0] - 2026-10-14

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

<!-- The Unreleased and 1.1.2 links compare against the v1.1.2 tag, which is
     created when 1.1.2 ships. v0.0.0-stage has no tag, so its link does not
     resolve. -->

[Unreleased]: https://github.com/normful/parallel-web-pi-extension-fork/compare/v1.1.2...HEAD
[1.1.2]: https://github.com/normful/parallel-web-pi-extension-fork/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/normful/parallel-web-pi-extension-fork/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/normful/parallel-web-pi-extension-fork/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/normful/parallel-web-pi-extension-fork/releases/tag/v1.0.0
[0.0.0-stage]: https://github.com/normful/parallel-web-pi-extension-fork/releases/tag/v0.0.0-stage
