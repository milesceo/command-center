# Session prompt: Command Center for macOS, Hugging Face models, lighter runtime

You are working in my fork of the upstream project `engineerlish/geeked`. My fork currently lives at `https://github.com/milesceo/geeked` and will be renamed to `https://github.com/milesceo/command-center` in Phase R. I am the owner of this fork (GitHub user `milesceo`). My machine is a Mac (assume Apple Silicon first; Intel must still compile).

The app is being renamed to **Command Center**. From here on, "the app" and "Command Center" mean this project.

Goal in one line: **rename the app to Command Center, make it a first-class macOS app, lighter to run, with the ability to add, test and customise my own models from Hugging Face, while keeping every existing feature and provider (Claude, ChatGPT via Codex, Grok) working as the original intended.**

"Keep everything mostly intact" is the overriding rule. You are renaming, porting and extending, not rewriting. If a change would remove or alter an existing feature's behaviour (beyond the rename), stop and ask me first.

---

## 0. Before you touch anything

1. Read `CLAUDE.md`, `docs/providers.md`, `docs/HANDOFF.md`, `docs/prompts/README.md` and every file in `.claude/agents/` and `.claude/hooks/` in full. They are binding. The workflow they describe (reviewer, ui-polish, tester, regulator subagents; Conventional Commits; squash merges; `pnpm check` green) applies to this session.
2. Follow the repo's own rule: **save this prompt verbatim** to `docs/prompts/2026-10-17-command-center-macos-huggingface.md` as the first commit of the first branch (`docs:` commit).
3. Enter **plan mode**. Produce a written plan covering every phase below, the files you expect to touch per phase, the risks, and anything you need me to decide. Wait for my approval before writing code.
4. Run `pnpm install && pnpm check && pnpm rust:lint` on the untouched fork and record the baseline (what passes, what fails, timings). Nothing you ship may make a passing check fail.

---

## 1. GitHub: full control of my fork

Set yourself up to operate on my repo end to end, safely.

- Verify `gh auth status`. If not logged in, tell me to run `gh auth login` (scopes: `repo`, `workflow`, `read:org`) and wait. Never ask me to paste a token into the chat.
- `git remote -v`: `origin` must be my fork. Add `upstream` → `engineerlish/geeked` (fetch only; set its push URL to `DISABLED`). Run `gh repo set-default` for my fork.
- Git identity: confirm `git config user.name` / `user.email` belong to `milesceo`. If not, stop and ask. Never change identity yourself.
- You may: create branches, commit, push branches, open PRs, request reviews from subagents, run and re-run Actions, read logs, create/label/close issues, and squash-merge **after** `pnpm check` and CI are green and the regulator returns PASS.
- You may not: force-push `main`, push to `upstream`, delete branches you did not create, change repo settings/secrets/branch protection (except the repo rename in Phase R, after I confirm), or publish a release without asking me.
- Ownership: change owner references `engineerlish` → `milesceo` in `CLAUDE.md`, README install links, issue templates, release workflow, the QA "Report on GitHub" URL, and the status-feed rules. **Keep** the original MIT copyright line in `LICENSE` and add mine beneath it.
- Keep the repo's "no Claude attribution" rules (no co-author trailers, no "Generated with" lines). Verify after every commit with `git log -1 --format='%an <%ae>%n%B'`.
- Add a `.claude/settings.local.json` (git-ignored) that pre-allows `git`, `gh`, `pnpm`, `cargo`, `node` and `brew list/info` commands so you don't stall on prompts. Do not loosen `.claude/hooks/agent-guard.mjs`.

---

## 2. Rename to Command Center (Phase R, branch `chore/rename-command-center`)

This project has renamed itself once before; follow that precedent exactly (`src-tauri/src/migrate.rs`, `src/lib/legacy.ts`, `scripts/check-name.mjs`, and the "Rename and data migration" notes in `CLAUDE.md`). No user data may be lost, overwritten or modified in place.

Naming scheme (use consistently):

| Thing | New value |
| --- | --- |
| Display name, window title, menus, tray, About, README, docs | `Command Center` |
| Slug / folder / file names | `command-center` |
| npm package scope | `@command-center/*` (e.g. `@command-center/desktop`, `@command-center/bridge`, `@command-center/protocol`) |
| Environment variables | `COMMAND_CENTER_*` (e.g. `COMMAND_CENTER_CLAUDE_EXECUTABLE`, `COMMAND_CENTER_BRIDGE_ENTRY`, `COMMAND_CENTER_QUERY_MODULE`) |
| localStorage keys | `command-center-*` |
| Custom events / URL schemes | `command-center://*` |
| SQLite file | `command-center.db` |
| Keychain / credential-store service | `command-center` |
| Tauri `productName` / binary | `Command Center` / `command-center` |
| Bundle identifier | `com.milesceo.commandcenter` |
| Prompt-library export format | `command-center-prompts` |
| GitHub repo | `milesceo/command-center` |

Requirements:

- **Data migration:** the bundle identifier change moves the config folder (SQLite) and the webview profile (localStorage). Extend `migrate.rs` so the app copies the previous database (+ `-wal`/`-shm`) to `command-center.db` and the webview storage to the new profile, using the same temp-name, byte-compare, never-overwrite, never-delete rules already in that file. It must handle users coming from **either** earlier name (chain the migrations).
- **Secrets:** API keys stored under the old credential-store service must be copied to the `command-center` service on first launch (read old → write new → verify → leave old intact). Unit-test it with a fake store.
- **Legacy keys:** `legacy.ts` copies old localStorage keys to `command-center-*` names; prompt-library import keeps accepting files exported under both older format names.
- **Env vars:** accept the old `GEEKED_*` variables as deprecated fallbacks for one release, logging a warning to stderr, so existing scripts don't break.
- **Name guard:** update `scripts/check-name.mjs` so the old names may appear only in migration/legacy files, the CHANGELOG, `docs/prompts/` (saved verbatim) and the upstream repository URL. `pnpm check` must enforce it.
- **Assets:** update the ASCII wordmark generator (`lib/ascii-field.ts`, `lib/ascii3d.ts`, the static logo in `index.html`), splash, launch messages, icons' alt text, screenshots' captions and Storybook titles. Regenerate `docs/TESTING.md` (`pnpm qa:docs`) and design tokens (`pnpm design:tokens`).
- **Status feed:** keep reading the existing feed URL; do not rename someone else's repo. Note in `CLAUDE.md` that I may fork it later.
- **Repo rename:** after the PR merges, ask me to confirm, then run `gh repo rename command-center` and update `origin`. GitHub redirects the old URL; update every in-repo link anyway.
- **CHANGELOG:** add an entry explaining the rename and the automatic migration.

Done when: a search for the old name finds it only in the allowed places; an install that already has chats, prefs, a PIN and API keys under the old name opens as Command Center with all of them intact; all tests green.

---

## 3. macOS port (Phase A, branch `feat/macos`)

The code currently assumes Windows in specific places. Fix each one behind platform checks so **Windows and Linux keep working exactly as before**. Known hotspots (verify and find the rest with a repo-wide search for `win32`, `cfg!(windows)`, `#[cfg(windows)]`, `.exe`, `cmd.exe`, `ComSpec`, `Ctrl`, `nsis`):

- **Sign-in terminals** (`packages/bridge/src/providers/claude.ts` `openTerminal`): on `darwin`, open Terminal.app with the command via `osascript` (properly escaped; respect `$TERM_PROGRAM` if iTerm is preferred). Keep the throw-with-instructions fallback for Linux. Add tests with the injectable `spawn`.
- **PATH for GUI apps:** macOS apps launched from Finder/Dock do not get the shell PATH, so `claude`, `codex`, `grok`, `node`, `ollama` won't be found. In `process.ts` `resolveCommand`, on `darwin` merge the login-shell PATH (resolve once, cached, with a timeout: `$SHELL -ilc 'printf %s "$PATH"'`) plus `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin`, `~/.npm-global/bin` and nvm/volta/fnm shims. Unit-test it.
- **Tauri config** (`tauri.conf.json`): add `app` and `dmg` bundle targets for macOS (keep `nsis`, `deb`), `minimumSystemVersion` (13.0), macOS icon (`icon.icns`), and `macOSPrivateApi` only if genuinely required.
- **Window chrome:** the window is frameless with a custom macOS-style title bar. On macOS use the native traffic lights (`titleBarStyle: "Overlay"`, `hiddenTitle: true`, sensible `trafficLightPosition`) and hide the custom window buttons there; keep the custom ones on Windows/Linux. Make the drag region correct.
- **Keyboard:** confirm `lib/shortcuts.ts` maps `Mod` to ⌘ on macOS everywhere (palette `⌘K`, help `⌘/`, etc.) and that the help dialog and README show ⌘ glyphs on Mac. Check nothing conflicts with system shortcuts (⌘H, ⌘M, ⌘Q, ⌘,). Add a standard macOS app menu (About Command Center, Settings `⌘,`, Hide, Quit, Edit menu so copy/paste works in the webview).
- **Rust:** audit `bridge.rs`, `migrate.rs`, `system.rs`, `lib.rs`. Tray: use a template (monochrome) tray icon on macOS. Close-to-tray: on macOS, closing the window should keep the app in the Dock/menu bar per platform convention (respect the existing `system.json` choice). Autostart: confirm `tauri-plugin-autostart` uses LaunchAgent on macOS. Keychain: `keyring` already has `apple-native`; verify secrets round-trip in Keychain and that the Keychain prompt names Command Center.
- **Preview scheme:** confirm the custom `preview:` scheme loads on WKWebView (it's `http://preview.localhost` only on Windows) and that the CSP `frame-src` covers it. The sandbox rules in CLAUDE.md are security-critical: do not weaken them.
- **Sidecar** (`scripts/prepare-sidecar.mjs`): build for `aarch64-apple-darwin` and `x86_64-apple-darwin`; correct executable bits; ad-hoc codesign (`codesign --force --sign -`) the bundled `node` and `claude` binaries so Gatekeeper doesn't kill them; strip quarantine in dev.
- **CI/release:** add `macos-14` (arm64) to the Rust job in `ci.yml`. Add a macOS job to `release.yml` that builds an unsigned `Command Center.dmg`, runs an adapted `smoke-installed.mjs` against the `.app` bundle, and attaches the dmg + checksum. Don't add signing secrets; document how I'd add Developer ID signing and notarisation later in `docs/macos.md`.
- **Docs:** README gets a macOS install section (Homebrew prerequisites, `xcode-select --install`, first-launch Gatekeeper steps: right-click → Open or `xattr -dr com.apple.quarantine "/Applications/Command Center.app"`). Update the Phase status table in `CLAUDE.md`.

Done when: `pnpm dev` launches the real Tauri window on my Mac; chat works with Claude, Codex and Grok; sign-in buttons open Terminal; preview, save-as, tray, lock, autostart work; `pnpm --filter @command-center/desktop tauri build` produces a `.dmg` that installs and launches its bundled bridge; all checks green on Windows CI too.

---

## 4. Lighter on the Mac (Phase B, branch `perf/macos-light`)

Measure first, then cut. Record before/after in the PR for: `.app` size, dmg size, cold start to interactive, idle RAM (app + webview + bridge), idle CPU over 60 s, and streaming frame times (`apps/desktop/e2e/perf.mjs`).

Targets (stretch where noted):

- **Optional "lite" runtime:** the bundled Claude runtime is ~250 MB. Add a build flavour (`pnpm sidecar --lite` / `COMMAND_CENTER_LITE=1`) that does **not** bundle `claude` or `node`, and instead uses the user's installed Claude Code and Node (found via the PATH fix above), with a clear in-app message if missing. The full bundle stays the default for release; lite is for my own machine. Reuse `COMMAND_CENTER_CLAUDE_EXECUTABLE`.
- **Bridge on demand:** start the Node bridge lazily on first chat/providers request rather than at launch, and shut it down after N minutes idle (setting, default 10). Splash must not wait on it.
- **Performance tiers:** `lib/performance.ts` already has tiers. On macOS, follow Low Power Mode / battery (if detectable cheaply from Rust) by capping to a lighter tier; finish the two TODO flags only if cheap. Ensure the ASCII splash and landing animations pause when the window is hidden or occluded.
- **Bundle trimming:** check Vite chunking (Mermaid, Shiki grammars, diff are already lazy; keep it so), remove dead dependencies, and verify the release Rust profile (`lto`, `codegen-units = 1`, `strip`, `opt-level = "s"` if it doesn't hurt). No feature removed.

Do not hit these targets by deleting features or tests.

---

## 5. Hugging Face and custom models (Phase C, branch `feat/huggingface-models`)

Add the ability to bring my own models, test them and customise them, through the **existing `Provider` interface** (`packages/bridge/src/providers/types.ts`, `registry.ts`). Research the current official docs before coding (Hugging Face Inference Providers, `huggingface.co/docs`, Ollama, MLX-LM, llama.cpp server) and record findings, dates and anything **unverified** in `docs/providers.md`, as the repo already does for the other providers.

Providers to add:

1. **`huggingface` (cloud):** Hugging Face Inference Providers via their OpenAI-compatible chat-completions router, streaming via SSE. Auth: an HF access token, stored **only** in the OS credential store via the existing `secrets.rs` (`api-key:huggingface` under the `command-center` service), attached per request exactly like the Grok key. Model id is any HF repo id (optionally with a `:provider` suffix where HF supports that).
2. **`local` (on-device, Apple Silicon):** one adapter speaking the OpenAI-compatible API to a local server, with presets for **Ollama** (`ollama pull hf.co/<user>/<repo>[:quant]`), **MLX-LM** (`mlx_lm.server`), **LM Studio** and **llama.cpp** (`llama-server -hf <repo>`). Configurable base URL (default localhost only; refuse non-loopback unless I explicitly allow it in Settings). Detect whether each runtime is installed/running and show it on the provider card. Command Center does not download or run model weights itself; it drives the runtime I installed.
3. Keep **Claude, Codex (ChatGPT) and Grok** exactly as they are. The rule "Claude never takes an API key" stays.

Custom model management (the "Model Lab"):

- New SQLite migration (never edit shipped ones) for a `custom_models` table: id, provider (`huggingface` | `local`), HF repo id, display name, runtime preset, base URL, quantisation tag, default system prompt, parameters JSON (temperature, top_p, top_k, max tokens, context length, stop sequences, repetition penalty), tags, created/updated. All SQL in `src/lib/repo.ts`.
- **Add model** flow: paste an HF repo id or URL → validate the id pattern → fetch public model metadata from the HF Hub API (pipeline tag, license, gated flag, available GGUF/MLX files and sizes) → warn if it isn't a text-generation/chat model, is gated without a token, or the chosen quant likely exceeds my Mac's unified memory (read total RAM from Rust) → for local, show the exact pull/serve command and a "Copy" / "Run in Terminal" button (Terminal via the macOS helper from Phase A; I press Enter).
- **Test:** a test panel that sends a prompt to one or several models side by side and shows streamed output, time to first token, tokens/s, total tokens, and errors. Results can be saved to the conversation as normal messages so existing diff/compare/preview features work on them.
- **Customise:** per-model presets of the parameters above plus system prompt, editable in Settings and per chat. Optional LoRA adapter field for the MLX preset only (passes `--adapter-path`; documented, not required).
- Custom models appear in the existing `ProviderModelPicker`, status dots/cards in Settings → AI agents, usage ledger (tokens; cost shown as "not available" for local, never invented) and command palette.
- **Protocol:** extend `packages/protocol` (types, validating parsers, tests first), bump `PROTOCOL_VERSION` to 5, and keep older requests parsing. Add parameters to `chat` as an optional, validated object. All feed/model values from the network are untrusted: never let them reach a shell, an unsanitised URL or HTML.
- Fake-SDK style tests for both new adapters (scripted SSE stream, cancel mid-stream, auth error, rate limit, malformed chunks), plus e2e coverage of add → test → chat.

---

## 6. How to work

- One branch and PR per phase, in order: **R → A → B → C**, each merged before the next starts. Small Conventional Commits.
- After each meaningful change run the **reviewer** (and **ui-polish** for UI). Run the **tester** before marking a phase done, and the **regulator** before every commit/push; nothing is pushed until it returns PASS. Fix all must-fix findings.
- Add QA checklist items (`apps/desktop/src/qa/checklist.ts`) for everything automation can't verify on macOS (rename migration from an existing install, Terminal sign-in, Keychain prompt, traffic lights, Gatekeeper, tray, local runtimes) and list their IDs under "Needs your eyes" in each PR. Regenerate `docs/TESTING.md` with `pnpm qa:docs`.
- Add Storybook stories for new components (Model Lab, model cards, add-model dialog).
- When unsure between two reasonable options, pick the one that changes less existing code, and note it in the PR.
- If something can't be done or verified on my machine (e.g. notarisation, Intel Mac), say so plainly in the PR rather than claiming it works.

## 7. Final report

At the end, give me: the merged PR links, the before/after performance table, the list of QA items that need my eyes, exact commands to run Command Center, build the dmg and add my first Hugging Face model, and any open risks or follow-ups.
