# Fork `@parallel-web/pi-extension` → `@normful/parallel-web-pi-extension` into this repo; port configs; get checks green

## Context

`/Users/norman/code/parallel-web-pi-extension-fork` is a git repo on `main` with no
commits. It becomes a self-maintained manual copy of `packages/pi-extension` from
`github.com/parallel-web/parallel-npm-packages` (branch `main`, commit
`3a4296260ef785055e16915ac7b76de744da0258`, tree `e1891fe9`), carrying later local patches. This change
only: (1) clone the source to a temp dir, (2) copy the `pi-extension` package contents
into this repo made self-contained, (3) port the lint/format/typecheck/test configs,
(4) prove every automatic check runs and passes here.

Decisions already made: single package at repo root; OAuth helper vendored into
`src/oauth/`; **npm** as package manager (not pnpm). No monorepo/workspace files.
The fork is **renamed** to `@normful/parallel-web-pi-extension` at version `1.0.0`
(upstream is `@parallel-web/pi-extension` 1.3.0).

## Approach

### 1. Clone source to a temp dir
```bash
TMP=$(mktemp -d)
git -C "$TMP" init -q -b main
git -C "$TMP" remote add origin https://github.com/parallel-web/parallel-npm-packages.git
git -C "$TMP" fetch -q --depth 1 origin 3a4296260ef785055e16915ac7b76de744da0258
git -C "$TMP" checkout -q FETCH_HEAD
SRC="$TMP/packages/pi-extension"
OAUTH="$TMP/packages/parallel-oauth"
```

### 2. Copy package into repo root
Copy from `$SRC` into the repo root (strip the `packages/pi-extension/` prefix):
- `src/**` (index.ts, parallel-auth.ts, parallel-client.ts, parallel-responses.ts,
  `__tests__/index.test.ts`, `__tests__/package.test.ts`,
  `__tests__/parallel-auth.test.ts`, `__tests__/parallel-client.test.ts`,
  `__tests__/parallel-responses.test.ts`)
- `tsup.config.ts`, `vitest.config.ts`, `README.md`
- `package.json`, `tsconfig.json`

Do NOT copy `package-lock.json` from source (it is a stale, unrelated artifact
referencing `parallel-web-cli`); regenerate instead (step 5).

### 3. Vendor the OAuth helper
`src/parallel-auth.ts` imports `@parallel-web/oauth`, which **is** the
`packages/parallel-oauth` package in the source monorepo (`loginWithParallel`, PKCE
flow). It is marked `private: true` there, so it 404s on npm and is never installed
by consumers — upstream bundles it into the extension at build time via tsup
`noExternal`. Vendoring its source replaces that bundling for a single-package repo.
Copy `$OAUTH/src/index.ts` to `src/oauth/index.ts`, and copy `$OAUTH/src/__tests__/index.test.ts`
to `src/oauth/__tests__/index.test.ts` (fix its `from '../index.js'` import to stay
relative — it currently resolves `src/oauth/index.ts`, which is already correct once
placed under `src/oauth/__tests__/`).

### 4. Patch configs for a single self-contained package

**`package.json`** — target end state (full contents):
- rename: set `name` to `@normful/parallel-web-pi-extension` and `version` to `1.0.0`
  (upstream was `@parallel-web/pi-extension` 1.3.0).
- keep `description`, `author`, `license`, `type: module`,
  `pi` block, `files`, `dependencies` (`parallel-web` 1.3.0, `typebox` ^1.1.37),
  `peerDependencies`, `keywords`, `publishConfig`.
- `devDependencies`: drop `"@parallel-web/oauth": "workspace:*"`; add the toolchain
  the ported configs need:
  ```json
  "@earendil-works/pi-ai": ">=0.83.0",
  "@types/node": "^20.0.0",
  "@typescript-eslint/eslint-plugin": "^6.13.0",
  "@typescript-eslint/parser": "^6.13.0",
  "eslint": "^8.54.0",
  "prettier": "^3.1.0",
  "tsup": "^8.0.1",
  "typescript": "^5.3.2",
  "vitest": "^1.0.4",
  "@vitest/coverage-v8": "^1.0.4"
  ```
- `scripts`: keep `build`, `dev`, `test`, `typecheck`, `clean`; add
  `"lint": "eslint ."`, `"lint:fix": "eslint . --fix"`,
  `"format": "prettier --write ."`, `"format:check": "prettier --check ."`.
- Remove the `repository.directory` field (or update `repository.url`) so it stays valid.
- **Update the copied `src/__tests__/package.test.ts`**: change
  `expect(manifest.name).toBe('@parallel-web/pi-extension')` to
  `expect(manifest.name).toBe('@normful/parallel-web-pi-extension')` (line ~9). The
  `pi.extensions` / `files` / `subagents` assertions are unchanged.

**`src/parallel-auth.ts`** — change the import line
`import { loginWithParallel as runParallelOAuth } from '@parallel-web/oauth';`
to `from './oauth/index.js';`. No other change.

**`src/__tests__/parallel-auth.test.ts`** — the module mock
`vi.mock('@parallel-web/oauth', () => ({ loginWithParallel: mocks.runParallelOAuth }))`
must target the vendored path: `vi.mock('../oauth/index.js', …)` (factory body unchanged).

**Client-attribution header (both request paths).** The literal is
`` `npm:@parallel-web/pi-extension/v${__PACKAGE_VERSION__ ?? '0.0.0'}` `` in
`src/parallel-client.ts` and `src/parallel-responses.ts`. Replace the
`@parallel-web/pi-extension` segment with `@normful/parallel-web-pi-extension` in both.
The header is pinned by exactly one test: `src/__tests__/parallel-responses.test.ts:85`
(its `version` import stays; only the `@parallel-web` scope changes). There is **no**
header assertion in `src/__tests__/index.test.ts` — its only upstream-name occurrence
is the `describe` label at line 85, which is renamed for consistency but is not an
assertion.

**`tsup.config.ts`** — remove `noExternal: ['@parallel-web/oauth']` (that package no
longer exists as an external); keep everything else. `__PACKAGE_VERSION__` define stays.

**`tsconfig.json`** — inline the inherited root options (the source extends
`../../tsconfig.json`). Final file:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "lib": ["ES2022"],
    "moduleResolution": "bundler", "resolveJsonModule": true,
    "allowJs": true, "checkJs": false,
    "outDir": "./dist", "rootDir": "./src",
    "declaration": true, "declarationMap": true, "sourceMap": true,
    "strict": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "noImplicitReturns": true, "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true, "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true, "isolatedModules": true,
    "allowSyntheticDefaultImports": true,
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "**/*.test.ts", "**/*.spec.ts"]
}
```

**`vitest.config.ts`** — keep as-is (uses `define` for `__PACKAGE_VERSION__`, includes
`src/**/*.test.ts`). Coverage provider v8 now resolves via `@vitest/coverage-v8`.

### 5. Port lint/format/test config files (repo root)
Create **`.eslintrc.json`** exactly as upstream root:
```json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": { "ecmaVersion": 2022, "sourceType": "module" },
  "plugins": ["@typescript-eslint"],
  "extends": ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  "rules": {
    "@typescript-eslint/no-explicit-any": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }
    ]
  },
  "env": { "node": true, "es2022": true },
  "ignorePatterns": ["dist", "node_modules", "coverage", "*.config.ts"]
}
```
Create **`.prettierrc`** and **`.prettierignore`** exactly as upstream root:
`.prettierrc` = `{semi:true, trailingComma:"es5", singleQuote:true, printWidth:80,
tabWidth:2, useTabs:false, arrowParens:"always"}`; `.prettierignore` =
`node_modules\ndist\ncoverage\npnpm-lock.yaml\n*.md`. Create **`.gitignore`** with at
least: `node_modules/`, `dist/`, `coverage/`, `.vitest/`, `*.tsbuildinfo`, `.env*`,
`*.log`, `.DS_Store`.

Note: the copied `README.md` matches `*.md` in `.prettierignore`, so `format:check`
ignores it (no reformatting churn).

### 6. Install and lock (npm)
```bash
npm install
```
This creates `node_modules/` and a fresh `package-lock.json` (replacing the stale
source one that was intentionally not copied).

### 7. Run every automatic check against the copied files; fix fail-  
runs
Run each; first failures will be formatting — run `npm run format` once, then re-run all:
```bash
npm run lint
npm run format:check
npm run typecheck
npm test
npm run build
```
Expected fixes needed during this step:
- **Prettier**: the copied sources may need reformatting to the ported `.prettierrc`.
  Run `npm run format` then re-run `format:check`. (Do not hand-edit.)
- **Typecheck**: `tsconfig.json` excludes `**/*.test.ts`, so tests are not typechecked.
  The `../../package.json` import in `parallel-responses.test.ts` is resolved by
  vite/vitest, not by `tsc`, so it needs no change. If a non-test file trips
  `noUnusedLocals`, fix the binding rather than relaxing the flag.
- **ESLint**: `src/oauth/index.ts` may trigger `no-unused-vars` on a destructured unused
  binding; fix by prefixing `_` (matches ignore pattern) rather than disabling the rule.

## Critical files & anchors
- `package.json` — root manifest; scripts/deps drive all checks; carries the `name`
  rename and `version` 1.0.0 (step 4).
- `src/parallel-auth.ts` — the only file importing the vendored oauth helper (step 4).
- `tsup.config.ts` — drop `noExternal` after vendoring (step 4).
- `tsconfig.json` — must be self-contained (no `extends ../../`) (step 4).
- `.eslintrc.json`, `.prettierrc` — copied verbatim from upstream root (step 5).

## Verification
All commands run from the repo root after `npm install`:
1. `npm run lint` → exits 0, no errors.
2. `npm run format:check` → "All matched files use Prettier code style".
3. `npm run typecheck` → exits 0.
4. `npm test` → all suites pass. Must include the 5 ported pi-extension tests plus the
   vendored oauth test (7 oauth cases). Sample concrete assertions that prove the copy
   intact: `parallel-client.test.ts` asserts `runParallelSearch('test-key', …)` POSTs to
   `https://api.parallel.ai/v1/search` with `mode:'fast'`; `package.test.ts` asserts
   `manifest.name === '@normful/parallel-web-pi-extension'` and
   `pi.extensions === ['./dist/index.js']`; `parallel-responses.test.ts:85` asserts the
   outgoing `X-Tool-Calling-Package === 'npm:@normful/parallel-web-pi-extension/v1.0.0'`;
   `parallel-auth.test.ts` asserts the provider resolves stored creds and falls back to
   `PARALLEL_API_KEY`; `src/oauth/__tests__/index.test.ts` (7 cases) exercises the PKCE
   flow against a loopback server.
5. `npm run build` → emits `dist/index.js` (ESM) + `dist/index.d.ts`; then
   `node --input-type=module -e "await import('./dist/index.js')"` succeeds (smoke that the
   built entry parses and loads).

## Assumptions & contingencies
- **pi-ai / pi-coding-agent availability**: `@earendil-works/pi-ai` and
  `@earendil-works/pi-coding-agent` are on npm (latest 1.2.0; `>=0.83.0` range resolves).
  If `npm install` fails resolving the peer/`>=0.83.0` range against the published set,
  pin to the newest published version satisfying it (e.g. `1.2.0`) in both
  `devDependencies` and `peerDependencies` and re-run step 7.
- **`minimumReleaseAge`/build scripts**: those are pnpm-only concerns; npm is not
  affected. `esbuild` postinstall runs normally.
- **Vitest 1.x + Node 26**: if vitest 1.6 cannot run on Node 26, bump `vitest` and
  `@vitest/coverage-v8` together to the newest 1.x (or 3.x if needed) and re-run step 7;
  config API used (`define`, `test.globals/environment/include/coverage`) is stable
  across those versions.
- **Coverage**: no `test:coverage` script is required by the request; `@vitest/coverage-v8`
  is included so the config's `coverage.provider:'v8'` resolves if invoked.
- **Publish metadata**: `repository.directory` is removed since the fork is not the
  monorepo; `publishConfig.access` is kept.
- **Renamed package in copied tests**: `package.test.ts` pins the manifest name. Update
  it to `@normful/parallel-web-pi-extension`; if any other copied assertion still pins
  the upstream name or header scope, update it to the new value rather than weakening
  the test.

## Execution record (2026-10-14)

Node v26.7.0, npm 10.9.8, source commit `3a4296260ef785055e16915ac7b76de744da0258`:

- `npm run lint` → exit 0.
- `npm run format:check` → clean on the first run; `npm run format` was not needed.
- `npm run typecheck` → exit 0.
- `npm test` → 6 files, 143 tests passed; the oauth suite reports 7 tests.
- `npm run build` → `dist/index.js` 29.1 KB (ESM) + `dist/index.d.ts`;
  `await import('./dist/index.js')` loads and exports `default`.
- Vendor check: the built bundle contains the `platform.parallel.ai` PKCE flow, and the
  inlined header literal is `npm:@normful/parallel-web-pi-extension/v1.0.0`.
- Deviations actually taken: step 1 pins the commit SHA; README renamed with npm
  commands and repo-root paths; no vitest bump was needed (1.6.1 runs on Node 26).
- Live load, beyond this plan's checks: `pi 1.1.0 --no-extensions --no-skills -e
  ./dist/index.js -p …` exits 0, and the model sees `web_search`, `web_fetch` and
  `web_research`. This is the only evidence that the real Pi binary accepts the build;
  the plan's checks all stop at `import('./dist/index.js')`.
- Added after the plan was written: `prepare` and `prepublishOnly` both run
  `npm run build`, so a publish cannot ship a `files` list whose `dist/` is absent.
- Follow-up after the port: `pi.extensions` moved to `./src/index.ts`, and both
  header sites now read the version from `package.json` at runtime
  (`import pkg from '../package.json' with { type: 'json' }`), so the tsup and
  vitest `define` for `__PACKAGE_VERSION__` is gone. Pi's loader transpiles TS
  with jiti, so src loads with no build; `npm run build` still emits `dist/` for
  publishing and `files` gained `src`.
