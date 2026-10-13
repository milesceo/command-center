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
- **Protocol (v2):** `packages/protocol` holds the shared TS types, validating parsers and NDJSON helpers. Source-only (no build step). Transport is newline-delimited JSON over the sidecar's stdio; stdout is protocol only, stderr is logs. Requests: `ping`, `chat`, `cancel`. A `chat` is answered by `chat.text` / `chat.tool_use` / `chat.tool_result` / `chat.rate_limit` events (all carrying the request `id`) and exactly one terminal event: `chat.done` (`completed` or `cancelled`) or `error` (structured `code`, plus `resetsAt`/`limitType` for limits). Bump `PROTOCOL_VERSION` on any breaking change.
- **Process wiring:** Rust (`src-tauri/src/bridge.rs`) spawns `node packages/bridge/dist/main.mjs`, exposes `bridge_start` / `bridge_send` commands and re-emits each stdout line as a `bridge://line` event. Rust treats lines as opaque; the UI parses them with `BridgeClient` (`src/lib/bridge.ts`).
- **Persistence:** SQLite via `tauri-plugin-sql`. Migrations in `src-tauri/migrations`, registered in `src-tauri/src/lib.rs`. Tables: `conversations` (title, pinned, model, system prompt, tools mode, cwd) and `messages` (role, content, attachments JSON, status `complete|stopped|error`, error JSON, model, token counts). All SQL lives in `src/lib/repo.ts`, written with `?` placeholders; the Tauri adapter in `src/lib/db.ts` renumbers them to `$1..$n` as the plugin documents. Search is `LIKE` over titles and message content.

### Chat design decisions

- **The app owns history; the bridge is stateless.** Every `chat` request carries the full transcript (SQLite is the source of truth). The bridge replays prior turns as a transcript inside the prompt (`packages/bridge/src/prompt.ts`, oldest turns dropped above ~400k chars) and runs a fresh, non-persisted query (`persistSession: false`, `settingSources: []`). This is what makes edit, regenerate, model switching and stopped replies trivial and keeps `~/.claude` clean. Trade-off: tool results from earlier turns are not carried forward, and there is no server-side session to resume.
- **Tools are opt-in per conversation.** `off` (default): `tools: []`, one turn. `readonly`: only Read/Glob/Grep in the chosen folder, `permissionMode: 'dontAsk'` so anything else is denied instead of prompting (there is no permission UI yet). No edit or shell tools exist in the app; adding them needs a permission-prompt UI first.
- **Subscription only.** `runtimeEnv()` strips `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the runtime's environment so a stray key can never silently switch billing. Never add API-key handling. Without tools the runtime runs in `os.tmpdir()` so it does not leak the app's own path to the model.
- **Errors are structured.** The bridge maps SDK errors (`authentication_failed`, rate-limit info, thrown text) to protocol codes in `errors.ts`; the UI turns codes into friendly copy in `src/lib/errors.ts`. Raw messages only appear under "Details" for unexpected errors. The SDK reports `resetsAt` in unix seconds; `normalizeResetsAt` converts to ms.
- **Streaming UI.** `chat` store buffers deltas and flushes once per animation frame (every 100 ms past 12k chars). Markdown is split into top-level blocks (`markdown-blocks.ts`) and each block is memoized, so only the last block re-parses. Code highlighting uses one shared lowlight instance (`rehype-lowlight.ts`); `rehype-highlight` rebuilds its grammars on every render and must not be reintroduced. The transcript is virtualized with `@tanstack/react-virtual`.
- **Zustand v5 selectors must return stable references.** A selector that builds a new object (like `selectActiveSettings`) must go through `useShallow` (see `useActiveSettings`) or React loops forever.

## Folder structure

```
apps/desktop/src/components/{ui,shell,chat}  generic components / app shell / chat UI
apps/desktop/src/stores                  Zustand stores (ui, bridge, conversations, chat)
apps/desktop/src/lib                     bridge client, tauri helpers, db + repo, errors, markdown utils
apps/desktop/e2e                         browser end-to-end harness (real UI + real bridge process + real SQLite file)
apps/desktop/src/styles/index.css        design tokens (CSS variables) + Tailwind theme
apps/desktop/src-tauri                   Rust core, migrations, capabilities, icons
packages/protocol/src                    message types, parse/encode, tests
packages/bridge/src                      main.ts (stdio loop), handler.ts (dispatcher), chat.ts (runner), translate.ts (SDK -> events),
                                         errors.ts, options.ts, prompt.ts, sdk.ts (lazy SDK load)
packages/bridge/test/fake-sdk.mjs        scripted stand-in for the SDK (PROGRAMISH_QUERY_MODULE) used by process tests and e2e
```

## Conventions

- TypeScript strict (plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`). Small typed modules; write complete files; comments explain why.
- Style via design tokens only (`bg-surface`, `text-fg-muted`, ...); dark is default, light via `[data-theme='light']`. Restrained, Linear/Raycast-like: subtle borders, tight spacing, no decorative gradients. Fonts: Geist (UI) and Geist Mono (code), bundled locally.
- Protocol changes start in `packages/protocol` with tests. Never edit a shipped SQL migration; add a new one.
- Keep the SQL capability list in `src-tauri/capabilities/default.json` minimal.

## Commands

`pnpm install`, `pnpm dev` (Tauri), `pnpm dev:web` (browser UI only), `pnpm check` (format + lint + typecheck + test), `pnpm build`, `pnpm rust:fmt`, `pnpm rust:lint`. Not in CI (needs Chromium; set `E2E_CHROMIUM` if it is not under `/opt/pw-browsers`): `pnpm --filter @programish/desktop e2e` runs the browser end-to-end suite against a fake SDK (`E2E_REAL=1` uses the real Claude runtime and your login), and `E2E_PROD=1 node apps/desktop/e2e/perf.mjs` (after `pnpm build`) checks streaming frame times on the production build. CI (`.github/workflows/ci.yml`) runs the JS checks on Ubuntu and `cargo fmt`/`clippy`/`test` on Ubuntu and Windows.

## Phase status

Update this section at the end of every phase.

| Phase           | Status      | Notes                                                                                                                                                                                                                                                                   |
| --------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation   | Done        | Monorepo, app shell (theme, sidebar, panels), protocol + bridge ping/pong, SQLite schema, CI, docs. Merged in PR #1.                                                                                                                                                    |
| 2. Chat core    | In review   | Real streaming chat via the Agent SDK, stop, model select, per-conversation system prompt and read-only tools, friendly auth/limit errors, markdown + code blocks, edit/regenerate/copy, attachments, conversations (rename/pin/delete/search), virtualized transcript. |
| 3. Code tooling | Not started | Diffs, preview panel content, richer code actions (save/open in editor), math/mermaid if wanted.                                                                                                                                                                        |
| 4. Packaging    | Not started | Bundle the bridge as a real sidecar (Node runtime), Windows installer, release build.                                                                                                                                                                                   |

Known gaps after phase 2:

- Release builds cannot find the bridge (dev only, see `entry_path` in `bridge.rs`); the SDK is `--external` in the esbuild bundle, so packaging must ship `node_modules` or bundle it.
- Verified in a Linux container (UI in headless Chromium with an emulated Tauri IPC, real bridge process, real SQLite file, and the real Claude runtime). The Tauri window, the SQL plugin's real placeholder handling and WebView2 itself were not exercised: first launch on Windows 11 is the remaining check. Rust is compiled by CI only.
- No permission UI, so no edit/shell tools. Earlier-turn tool results are not replayed (stateless transcript).
- Search is `LIKE` (fine for personal volumes); move to FTS5 if it gets slow.
