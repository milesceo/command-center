# Contributing

Programish is a personal project, but it is developed like a team project: small changes, reviewed through pull requests, with CI green before merging.

## Workflow

1. Branch from `main`: `feat/<topic>`, `fix/<topic>`, `chore/<topic>`, `docs/<topic>`.
2. Make small, logical commits using [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:` (optionally scoped, e.g. `feat(bridge):`).
3. Run `pnpm check` (and `pnpm rust:fmt && pnpm rust:lint` if you touched Rust) before pushing.
4. Open a pull request with a clear summary and merge it with a squash merge once CI passes.
5. Never force-push `main`. Never commit secrets, tokens or local config (`.env*`, `.claude/settings.local.json`).

## Conventions

- **TypeScript strict.** No `any` without a comment explaining why. Prefer small, typed modules.
- **Comments explain why, not what.**
- **Protocol first.** Any message between the app and the bridge is defined in `packages/protocol` (with a test) before either side uses it.
- **Design tokens only.** UI uses the CSS variables in `apps/desktop/src/styles/index.css` through Tailwind utilities (`bg-surface`, `text-fg-muted`). No raw hex colors in components.
- **Components** live in `apps/desktop/src/components/ui` (generic, owned in-repo) or `components/shell` (app-specific).
- **State** is Zustand stores in `src/stores`. Persistent data goes to SQLite through a new migration; never edit a shipped migration.
- **Cross-platform:** use `node:path` / `std::path`, never hard-coded separators, and keep scripts runnable on Windows.

## Adding a SQL migration

1. Add `apps/desktop/src-tauri/migrations/000N_description.sql`.
2. Register it, in order, in `migrations()` in `src-tauri/src/lib.rs`.
3. Extend `src/lib/schema.test.ts` so the schema is exercised by Vitest.

## Adding a highlighted language

Add a loader line to `LOADERS` in `apps/desktop/src/lib/highlight-core.ts` (one lazy chunk per grammar) and, if models use other names for it, aliases in `lib/fence.ts`.

## Adding a keyboard shortcut

Add it to `SHORTCUTS` in `apps/desktop/src/lib/shortcuts.ts` (the help dialog reads the same list), handle its id in `lib/use-shortcuts.ts`, and add a test in `src/shortcuts.test.tsx`. Keep to `Mod+<key>` or `Mod+Shift+<key>`: no Alt, because Ctrl+Alt is AltGr on many Windows layouts.

## Working on the preview panel

Previewed code is untrusted. Read the "Preview isolation" notes in `CLAUDE.md` before changing the iframe's `sandbox`, the CSP, the `preview:` scheme or the capabilities. The e2e suite includes an isolation probe; run it.

## End-to-end checks

`pnpm --filter @programish/desktop e2e` drives the real UI in headless Chromium against the real bridge process and a real SQLite file, with the Tauri side emulated (`apps/desktop/e2e/harness.mjs`). It is not part of CI because it needs a Chromium binary (`E2E_CHROMIUM`). Run it, and `E2E_PROD=1 node apps/desktop/e2e/perf.mjs`, after touching streaming, the transcript or the stores.

## Accessibility and performance checks

`node apps/desktop/e2e/a11y.mjs` audits every view in both themes with axe-core and exits non-zero on any serious or critical finding; run it after touching colors or adding a view. `E2E_PROD=1 node apps/desktop/e2e/startup.mjs` (after `pnpm build`) prints startup time, idle heap and bundle sizes; compare before and after when changing dependencies or startup work.

## Releasing

See "Releasing" in the README and "Packaging and release design decisions" in `CLAUDE.md`. Update `CHANGELOG.md` in the same PR as the change when it is user-visible.

## Adding a bridge message

1. Add the request and/or event types, parser and tests in `packages/protocol`.
2. Handle the request in `packages/bridge/src/handler.ts`.
3. Expose it through `BridgeClient` in `apps/desktop/src/lib/bridge.ts`.
