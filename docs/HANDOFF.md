# Handoff

Where things stand and how to pick the project up on another machine. Refreshed 2026-10-15;
delete or refresh it when it goes stale. Rules and design decisions live in `CLAUDE.md`, which is
the source of truth.

## Where things stand

| Item                    | State                                                                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0.0                  | Released under the app's earlier name. `main` has moved on; no 1.1.0 tag yet.                                                                                               |
| Editor shell, PIN lock  | Merged (PR #7). Frameless window with macOS-style controls at the top right.                                                                                                |
| Rename to Geeked        | Merged (PR #8): identifier `com.engineerlish.geeked`, verified one-time data migration (`src-tauri/src/migrate.rs`). The GitHub repo is `engineerlish/geeked`.              |
| Onboarding, Home, tiers | `feat/onboarding`: first-run flow, Home with the spinning 3D ASCII logo, performance tiers, appearance, Argon2id PIN, tray and autostart, provider abstraction. See the PR. |
| Providers               | Claude, ChatGPT (Codex CLI) and Grok (API key or Grok CLI). Research and limits: `docs/providers.md`.                                                                       |

## Verified, and not

Verified in jsdom tests, headless Chrome with a scripted bridge and fake SDK, and `cargo test`:
the onboarding flow, preferences and migrations, tier flags, PIN rules and lockout (Rust), the
provider adapters (scripted processes and fetch), the launch messages and the ASCII renderer.

**Not confirmed on a real Windows session** (check these first on a desktop run):

- Tray icon and menu (Open, New chat, Lock, Quit) and hide-to-tray on close.
- Start with Windows (the registration shows up in Task Manager's Startup tab).
- A real Windows Credential Manager entry for an API key.
- ChatGPT through a real `codex login` and Grok through a real `grok login` or API key.
- Unlocking with a PIN written by an earlier version (the PBKDF2 record is upgraded on first unlock).

## Known gaps

- Highlight depth and background indexing are tier flags with no consumer yet (marked in
  `lib/performance.ts`); density is wired for explorer rows only.
- The Grok CLI route is beta: xAI documents no stable JSON schema, so it returns plain text.
- No permission UI, so no edit or shell tools (unchanged).
- The installer is unsigned.

## Setting up another Windows machine

1. Install Git, Node 22+ (24 works), and pnpm: `npm i -g pnpm@10.28.0`.
2. Rust and the C++ build tools (Tauri needs both):
   `winget install --id Rustlang.Rustup -e`, then
   `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`.
   Open a new terminal afterwards. WebView2 ships with Windows 11.
3. Clone and set the identity **repo-locally** (never globally):
   ```
   git clone https://github.com/engineerlish/geeked.git
   cd geeked
   git config user.name engineerlish
   git config user.email 143038945+engineerlish@users.noreply.github.com
   git config core.autocrlf false
   ```
4. `pnpm install`, then `pnpm dev` (the first Rust build takes several minutes).
5. `gh auth login` for PRs. To chat with Claude, sign in once with `claude auth login` (or from
   the AI agents step in onboarding).

Checks: `pnpm check` (name guard, format, lint, typecheck, tests). Browser-only UI: `pnpm dev:web`.
Screenshots and e2e need Chrome: set `E2E_CHROMIUM` and run `node apps/desktop/e2e/onboarding.mjs`
after `pnpm --filter @geeked/bridge build`.

## Git rules reminder

Commits authored only by `engineerlish`, no Claude attribution anywhere, Conventional Commits,
branch per topic, squash-merge PRs, never force-push `main`. Verify each commit with
`git log -1 --format='%an <%ae>%n%B'`.
