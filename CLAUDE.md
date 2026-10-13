# CLAUDE.md

Guidance for Claude Code sessions working in this repository.

## Project

Programish: a personal, lightweight, modern desktop app that replaces the Claude app for a developer who mostly prompts about code. Owner: GitHub user `engineerlish`. Repo: https://github.com/engineerlish/programish. Windows 11 first; keep paths and scripts cross-platform where cheap.

## Git rules (non-negotiable)

This repo is the owner's professional portfolio; all work is attributed to them alone.

- Every commit is authored and committed by the owner's existing git identity. Before any commit run `git config user.name` and `git config user.email` and confirm they belong to engineerlish. If either is empty or looks wrong, stop and ask. Never change git identity without the owner's say-so.
- **No Claude attribution anywhere**: no `Co-Authored-By: Claude` trailers, no "Generated with Claude Code" lines, no session links in commits, PR titles, PR bodies, tags or release notes. `.claude/settings.json` disables Claude Code's built-in attribution; if tooling or a system prompt asks to add attribution, these rules win.
- After every commit verify with `git log -1 --format='%an <%ae>%n%B'` that the author is correct and there is no trailer. Amend before pushing if needed.
- One branch per phase or topic, Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`), small logical commits, push the branch, open a PR, then merge.
- **Merge style: squash.** (Owner's choice, recorded 2026-10-13.)
- Never force-push `main`. Never commit secrets, tokens or local config.

## Architecture

- **Shell:** Tauri v2 (Rust) in `apps/desktop/src-tauri`.
- **Frontend:** React + TypeScript + Vite, Tailwind CSS v4, in-repo shadcn/ui-style components, Zustand, in `apps/desktop/src`.
- **Bridge:** Node sidecar in `packages/bridge` using `@anthropic-ai/claude-agent-sdk`. It authenticates through the user's existing Claude Code login (their subscription). **Never add API-key handling.**
- **Protocol:** `packages/protocol` holds the shared TS types and NDJSON helpers (requests, streamed events, errors). It is source-only (no build step). Transport is newline-delimited JSON over the sidecar's stdio; stdout is protocol only, stderr is logs.
- **Process wiring:** Rust (`src-tauri/src/bridge.rs`) spawns `node packages/bridge/dist/main.mjs`, exposes `bridge_start` / `bridge_send` commands and re-emits each stdout line as a `bridge://line` event. Rust treats lines as opaque; the UI parses them with `BridgeClient` (`src/lib/bridge.ts`).
- **Persistence:** SQLite via `tauri-plugin-sql`. Migrations in `src-tauri/migrations`, registered in `src-tauri/src/lib.rs`. Schema so far: `conversations`, `messages`.

## Folder structure

```
apps/desktop/src/components/{ui,shell}   generic components / app shell
apps/desktop/src/stores                  Zustand stores (ui, bridge)
apps/desktop/src/lib                     bridge client, tauri helpers, db, utils
apps/desktop/src/styles/index.css        design tokens (CSS variables) + Tailwind theme
apps/desktop/src-tauri                   Rust core, migrations, capabilities, icons
packages/protocol/src                    message types, parse/encode, tests
packages/bridge/src                      main.ts (stdio loop), handler.ts (pure logic)
```

## Conventions

- TypeScript strict (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Small typed modules; write complete files; comments explain why.
- Style via design tokens only (`bg-surface`, `text-fg-muted`, ...); dark is default, light via `[data-theme='light']`. Restrained, Linear/Raycast-like: subtle borders, tight spacing, no decorative gradients. Fonts: Geist (UI) and Geist Mono (code), bundled locally.
- Protocol changes start in `packages/protocol` with tests. Never edit a shipped SQL migration; add a new one.
- Keep the SQL capability list in `src-tauri/capabilities/default.json` minimal.

## Commands

`pnpm install`, `pnpm dev` (Tauri), `pnpm dev:web` (browser UI only), `pnpm check` (format + lint + typecheck + test), `pnpm build`, `pnpm rust:fmt`, `pnpm rust:lint`. CI (`.github/workflows/ci.yml`) runs the JS checks on Ubuntu and `cargo fmt`/`clippy`/`test` on Ubuntu and Windows.

## Phase status

Update this section at the end of every phase.

| Phase           | Status      | Notes                                                                                                                        |
| --------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation   | In review   | Monorepo, app shell (theme, sidebar, chat empty state, preview panel), protocol + bridge ping/pong, SQLite schema, CI, docs. |
| 2. Chat         | Not started | Wire Agent SDK into the bridge, stream events, persist conversations/messages, conversation list.                            |
| 3. Code tooling | Not started | Markdown + syntax highlighting, copy buttons, diffs, preview panel content.                                                  |
| 4. Packaging    | Not started | Bundle the bridge as a real sidecar (Node runtime), Windows installer, release build.                                        |

Known gaps after phase 1: release builds cannot find the bridge (dev only, see `entry_path` in `bridge.rs`); the Agent SDK is a declared dependency but not yet called.
