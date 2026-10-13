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
- **Protocol (v3):** `packages/protocol` holds the shared TS types, validating parsers and NDJSON helpers. Source-only (no build step). Transport is newline-delimited JSON over the sidecar's stdio; stdout is protocol only, stderr is logs. Requests: `ping`, `chat`, `cancel`, `usage`. A `chat` is answered by `chat.text` / `chat.tool_use` / `chat.tool_result` / `chat.rate_limit` / `chat.limits` events (all carrying the request `id`) and exactly one terminal event: `chat.done` (`completed` or `cancelled`, with the reply's per-model token usage) or `error` (structured `code`, plus `resetsAt`/`limitType` for limits). `usage` is answered by one `usage.report` (plan windows, subscription type, extra usage). Bump `PROTOCOL_VERSION` on any breaking change.
- **Process wiring:** Rust (`src-tauri/src/bridge.rs`) spawns `node packages/bridge/dist/main.mjs`, exposes `bridge_start` / `bridge_send` commands and re-emits each stdout line as a `bridge://line` event. Rust treats lines as opaque; the UI parses them with `BridgeClient` (`src/lib/bridge.ts`).
- **Persistence:** SQLite via `tauri-plugin-sql`. Migrations in `src-tauri/migrations`, registered in `src-tauri/src/lib.rs`. Tables: `conversations` (title, pinned, model, system prompt, tools mode, cwd, project, attached library system prompt and its variable values), `messages` (role, content, attachments JSON, status `complete|stopped|error`, error JSON, model, token, cache and cost fields), `prompts` (kind `prompt|system`, title, tags JSON, body), `projects` (name, default system prompt and its variable values), `usage_log` (one row per reply per model) and `usage_windows` (latest plan window readings). All SQL lives in `src/lib/repo.ts`, written with `?` placeholders; the Tauri adapter in `src/lib/db.ts` renumbers them to `$1..$n` as the plugin documents. Search is `LIKE` over titles and message content.

### Code tools design decisions

- **Highlighting:** Shiki with its JS regex engine (no WASM), a **CSS-variables theme**, and a curated list of grammars in `lib/highlight-core.ts`, each a lazy chunk. Token colors are `var(--shiki-*)`; the light/dark values live in `styles/index.css`, so a theme switch recolors every block with no re-highlighting. Tokenizing runs in a Web Worker (`highlight.worker.ts`, ES module worker, per-block channels so stale requests are dropped); `highlight.ts` falls back to in-thread highlighting where `Worker` does not exist (unit tests). To support a language, add one loader line to `LOADERS` (and aliases in `fence.ts`). Never highlight on the main thread: it caused 100–300 ms hitches while streaming.
- **Code blocks** (`components/code/CodeBlock.tsx`): each block has a stable key `messageId:blockIndex:fenceLine`. `StreamState.messageId` is generated when a reply starts and reused as the stored message's id, so keys survive the streaming-to-stored hand-off. Fence info supports `title="a.ts"`, `filename=a.ts`, `ts:a.ts` and a bare path (`lib/fence.ts`).
- **Diffs:** `lib/diff.ts` parses unified diffs leniently (wrong hunk counts, missing context spaces, no `@@` headers are all tolerated; a hunk's `--- x`/`+++ y` pair is a file header only when a `@@` follows) and builds one model for the inline and side-by-side views; word-level highlights come from the `diff` library for paired removed/added lines. `DiffView` falls back to inline below 520 px. The diff library is lazy (`DiffBlock`, `DiffTab` are `React.lazy`).
- **Preview isolation (security-critical):** previewed HTML is untrusted. It runs in an iframe with `sandbox="allow-scripts"` only (never add `allow-same-origin`, `allow-popups`, `allow-top-navigation`, `allow-forms` or `allow-modals`). In the desktop app the document is registered with Rust (`preview_set`) and loaded from the custom `preview:` scheme (`src-tauri/src/preview.rs`, `http://preview.localhost` on Windows), which serves it with its own CSP header (`default-src 'none'`, scripts and styles allowed, `connect-src 'none'`, plus `sandbox allow-scripts`). A `srcdoc` iframe would inherit the app's CSP and could not run scripts. The page is a different origin with an opaque sandbox origin, so it cannot read the app, its storage or the bridge, and the Tauri IPC rejects it because no capability grants `remote` URLs (do not add one). `PREVIEW_CSP` is duplicated in `lib/preview-doc.ts` and `preview.rs`; a test enforces they match, and the e2e harness reads the Rust constant. The app CSP gained `frame-src preview: http://preview.localhost https://preview.localhost`. Console output arrives by `postMessage` and is accepted only from the frame's own `contentWindow` with its per-build id (`parseConsoleMessage`). Mermaid renders to SVG in the app (`securityLevel: 'strict'`), and the SVG is then shown inside the same sandbox. Markdown previews reuse the safe `Markdown` component (no raw HTML) with no iframe.
- **Preview tabs** live in `stores/preview.ts` (max 8). A tab opened from a block follows it by `sourceKey`: while the reply streams, `CodeBlock` pushes new code into the tab after a 250 ms debounce, which re-runs the page and clears its console.
- **Save as file** uses the native save dialog plus `plugin-fs` `writeTextFile`; paths picked in the dialog are added to the fs scope, and only `fs:allow-write-text-file` is granted. In a browser it downloads instead.
- **Shortcuts** are defined once in `lib/shortcuts.ts` (handler and help dialog share the table): copy last code block `Mod+Shift+C`, toggle preview `Mod+Shift+P`, toggle diff mode `Mod+Shift+D`, toggle sidebar `Mod+B`, help `Mod+/`. Matching is exact about modifiers (no Alt, to stay clear of AltGr layouts).
- **Mermaid** is imported lazily on first use; its large diagram-type chunks load only when that diagram type is rendered.

### Chat design decisions

- **The app owns history; the bridge is stateless.** Every `chat` request carries the full transcript (SQLite is the source of truth). The bridge replays prior turns as a transcript inside the prompt (`packages/bridge/src/prompt.ts`, oldest turns dropped above ~400k chars) and runs a fresh, non-persisted query (`persistSession: false`, `settingSources: []`). This is what makes edit, regenerate, model switching and stopped replies trivial and keeps `~/.claude` clean. Trade-off: tool results from earlier turns are not carried forward, and there is no server-side session to resume.
- **Tools are opt-in per conversation.** `off` (default): `tools: []`, one turn. `readonly`: only Read/Glob/Grep in the chosen folder, `permissionMode: 'dontAsk'` so anything else is denied instead of prompting (there is no permission UI yet). No edit or shell tools exist in the app; adding them needs a permission-prompt UI first.
- **Subscription only.** `runtimeEnv()` strips `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the runtime's environment so a stray key can never silently switch billing. Never add API-key handling. Without tools the runtime runs in `os.tmpdir()` so it does not leak the app's own path to the model.
- **Errors are structured.** The bridge maps SDK errors (`authentication_failed`, rate-limit info, thrown text) to protocol codes in `errors.ts`; the UI turns codes into friendly copy in `src/lib/errors.ts`. Raw messages only appear under "Details" for unexpected errors. The SDK reports `resetsAt` in unix seconds; `normalizeResetsAt` converts to ms.
- **Streaming UI.** `chat` store buffers deltas and flushes once per animation frame (every 100 ms past 12k chars). Markdown is split into top-level blocks (`markdown-blocks.ts`) and each block is memoized, so only the last block re-parses. Code highlighting uses one shared lowlight instance (`rehype-lowlight.ts`); `rehype-highlight` rebuilds its grammars on every render and must not be reintroduced. The transcript is virtualized with `@tanstack/react-virtual`.
- **Zustand v5 selectors must return stable references.** A selector that builds a new object (like `selectActiveSettings`) must go through `useShallow` (see `useActiveSettings`) or React loops forever.

### Usage and prompt library design decisions

- **Usage comes from the SDK result, never from estimates.** `usageFromResult` (bridge `usage.ts`) prefers `result.modelUsage` (per model, with `costUSD`) and falls back to `result.usage` for the model the run used. The desktop writes one `usage_log` row per reply per model right after `chat.done`. `usage_log` has no foreign keys on purpose: deleting or regenerating a message must not erase what was used. Replies the user stops part-way carry no usage (the SDK sends none), so they are not counted. Older rows written before phase 4 store `input_tokens` as the SDK's uncached input only.
- **Cost is "API-equivalent cost".** It is the SDK's `costUSD` list-price figure, informational on a subscription, never a bill. Always use `COST_LABEL`/`COST_NOTE` from `lib/format.ts`; never call it "spend" or "cost" alone.
- **Plan headroom is shown only when the SDK reports it, and never extrapolated.** Two sources: `rate_limit_event.rate_limit_info.unifiedWindows` (untyped in the SDK types but observed; fractions, `resetsAt` in unix seconds) arrives before each result as `chat.limits`, and the experimental `Query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` (percent, ISO time) answers the `usage` request. Both are parsed defensively. A login without them (API key, third-party provider, or a container without profile access) shows "not available" instead of a guess. A reading from before the window's last reset is flagged out of date.
- **Charts** (`components/usage`): hand-built SVG stacked bars following the dataviz rules (bars <= 24 px, 4 px rounded data end, 2 px gaps, legend that toggles series, text in text tokens, table view, hover tooltip, one validated palette `--series-1..4`). Day/week bucketing is done in SQLite on local time with Monday-based weeks.
- **Prompt library:** `prompts` rows are either `prompt` (inserted into the composer) or `system` (attached to a conversation or a project). `{{name}}` variables are extracted by `lib/prompt-vars.ts`; a prompt with variables opens `VariablesForm` first. A library system prompt is stored by reference plus variable values and rendered at send time (`lib/system-prompt.ts`: custom conversation text > attached library prompt > project default), so editing it updates every chat using it. The composer's `/` menu (`lib/slash.ts`, `SlashMenu`) searches prompt-kind rows. Export/import is a versioned JSON file (`programish-prompts` v1, `lib/prompt-library.ts`); import merges by id (newer wins) and skips identical duplicates.
- **Projects** are a flat grouping of conversations with an optional default system prompt; deleting one ungroups its chats.
- **Selectors must be referentially stable** (this bit twice again: `?? []` and `.filter()` inside a `useStore` selector). Select the raw value and derive it with `useMemo`/a module constant.

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

`pnpm install`, `pnpm dev` (Tauri), `pnpm dev:web` (browser UI only), `pnpm check` (format + lint + typecheck + test), `pnpm build`, `pnpm rust:fmt`, `pnpm rust:lint`. Not in CI (needs Chromium; set `E2E_CHROMIUM` if it is not under `/opt/pw-browsers`): `pnpm --filter @programish/desktop e2e` runs the browser end-to-end suite against a fake SDK (`E2E_REAL=1` uses the real Claude runtime and your login), and `E2E_PROD=1 node apps/desktop/e2e/perf.mjs` (after `pnpm build`) checks streaming frame times on the production build (budget: p95 frame <= 70 ms and no task over 150 ms at ~500 tokens/s). CI (`.github/workflows/ci.yml`) runs the JS checks on Ubuntu and `cargo fmt`/`clippy`/`test` on Ubuntu and Windows.

## Phase status

Update this section at the end of every phase.

| Phase                | Status      | Notes                                                                                                                                                                                                                                                                                    |
| -------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Foundation        | Done        | Monorepo, app shell (theme, sidebar, panels), protocol + bridge ping/pong, SQLite schema, CI, docs. Merged in PR #1.                                                                                                                                                                     |
| 2. Chat core         | Done        | Real streaming chat via the Agent SDK, stop, model select, per-conversation system prompt and read-only tools, friendly auth/limit errors, markdown + code blocks, edit/regenerate/copy, attachments, conversations (rename/pin/delete/search), virtualized transcript. Merged in PR #2. |
| 3. Code tools        | Done        | Shiki code blocks (actions, line numbers, collapse, wrap), diff view (inline/side-by-side, word-level), sandboxed live preview panel (HTML/SVG/Mermaid/Markdown, tabs, console, viewport widths, streaming auto-update), shortcuts + dialog. Merged in PR #3.                            |
| 4. Usage and prompts | In review   | Usage ledger from SDK results, Usage view (daily/weekly charts, models, top chats, plan headroom where the SDK reports it), per-chat totals in the header, prompt library with `{{variables}}`, `/` insert, import/export, projects with default system prompts.                         |
| 5. Packaging         | Not started | Bundle the bridge as a real sidecar (Node runtime), Windows installer, release build.                                                                                                                                                                                                    |

Known gaps after phase 4:

- Release builds cannot find the bridge (dev only, see `entry_path` in `bridge.rs`); the SDK is `--external` in the esbuild bundle, so packaging must ship `node_modules` or bundle it.
- Verified in a Linux container (UI in headless Chromium with an emulated Tauri IPC, real bridge process, real SQLite file, and the real Claude runtime). The Tauri window, the SQL plugin's real placeholder handling and WebView2 itself were not exercised: first launch on Windows 11 is the remaining check. Rust is compiled by CI only.
- No permission UI, so no edit/shell tools. Earlier-turn tool results are not replayed (stateless transcript).
- Plan headroom (5-hour/weekly windows) was verified only against fixtures and the SDK's types: the CI/dev container's login returns `rate_limits_available: false`, so real subscription values are unconfirmed until first run on a logged-in desktop. Usage tokens/cost were verified against a real SDK reply.
- Replies stopped part-way have no usage (the SDK sends none) and are not counted.
- Search is `LIKE` (fine for personal volumes); move to FTS5 if it gets slow.
- The `preview:` scheme, the save dialog and the fs plugin are exercised only by CI compilation and by the browser harness, which emulates them (same CSP header, same sandbox). Their behavior inside the real WebView2 window is unverified: check preview, console output and save on first Windows launch.
- Diff lines are not syntax highlighted (only changed words are marked). The preview iframe reloads on every update, so scroll position resets while a reply streams.
- Code blocks inside list items are matched to previews by line number, which is stable while streaming but would change if the model rewrites earlier text.
