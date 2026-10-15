# Handoff

State of the project and how to pick it up on another machine. Written 2026-10-15; delete or
refresh it when it goes stale. Rules and design decisions live in `CLAUDE.md`, which is the
source of truth; this file is the "where did we leave off".

## Where things stand

| Item                             | State                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| v1.0.0                           | Released: https://github.com/engineerlish/programish/releases/tag/v1.0.0 (tag on `08d0fc6`, unsigned NSIS installer, `SHA256SUMS.txt` matches)                   |
| `main`                           | At the v1.0.0 merge commit `08d0fc6`                                                                                                                             |
| PR #7 `feat/ide-shell` (draft)   | Editor-style shell, PIN lock landing page, macOS-style custom title bar. **This is the live branch.** Not merged; the default layout changes, so try it first.   |
| PR #6 `feat/ui-concepts` (draft) | Four concept prototypes the owner rejected. Superseded by #7; safe to close. `docs/ui-concepts.md` on that branch has the idea list if anything is worth mining. |
| `chore/v1-release`               | Already merged (PR #5); the remote branch can be deleted.                                                                                                        |

## Decisions made this session

- **UI direction:** an editor/IDE look with macOS-app polish (floating rounded panes, frosted
  explorer, command pill), not a chat-app clone. Both layouts are kept for now: `ide` (default)
  and `classic` (palette: "Use classic layout").
- **Custom title bar:** the window is frameless (`decorations: false`); traffic lights at the
  top-left, drag regions on the toolbar. The classic layout has a slim strip; the lock screen
  keeps the controls. Windows 11 Snap Layouts on the maximize button is lost by design.
- **PIN lock:** the owner sets the PIN on first launch (twice), with an explicit "continue
  without a PIN". It is a screen lock, **not encryption**; the SQLite file is plain. A forgotten
  PIN is only recoverable by erasing all local data (type DELETE). Details in `CLAUDE.md`.
- **Prototype scope:** the old concept switcher is not on this branch (it lives only on #6).

## Verified, and not

Verified on the owner's machine with the v1.0.0 installer and a real Claude login: streaming chat,
Stop keeps the partial reply, preview (sandboxed scripts run), Save as file, Usage view with real
plan headroom (5-hour and weekly).

Verified only in jsdom tests and headless Chrome with the fake SDK: the editor shell, the lock
flow and the ASCII animation. `cargo check` accepts the frameless config and its permissions.

**Not confirmed in a real window:** drag by the toolbar, double-click to maximize, resizing from
the edges of the frameless window, and the PIN flow under WebView2 (PBKDF2 and localStorage).
Check those first on a desktop run.

## Known small issues (not fixed)

- The status footer in the classic layout shows `v0.3.0`: `BRIDGE_VERSION` in
  `packages/bridge/src/handler.ts` was never bumped. Bump it or read it from `package.json`.
- Shortcut hints render as `CtrlK` (no separator) from `formatKeys` in `lib/shortcuts.ts`;
  the title-bar pill and the palette show it.
- Explorer has no rename or move-thread-to-project; projects can be created but threads cannot be
  assigned from the UI yet (the classic sidebar can).
- No sign-in screen: with no Claude Code login the first chat fails with an auth error. The
  bundled runtime can log in: run `claude.exe` from the install's `bridge` folder, then `/login`.
- Files in the editor are derived from code blocks, not saved anywhere; editing real files still
  needs the permission UI (see v1.1 ideas).

## v1.1 ideas (owner to choose; nothing started)

Code-sign the installer; reuse the `claude` on PATH to shrink the ~250 MB runtime out of the
installer; auto-updater; permission-prompt UI so edit/shell tools can be offered safely; FTS5
search; syntax-highlighted diff lines and no preview reload while streaming; per-reply token
counts; resume interrupted streams; macOS/Linux testing; an in-app "not signed in" screen that
starts the Claude login.

## Setting up another Windows machine

1. Install Git, Node 22+ (24 works), and pnpm: `npm i -g pnpm@10.28.0`.
2. Rust and the C++ build tools (Tauri needs both):
   `winget install --id Rustlang.Rustup -e`, then
   `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"`.
   Open a new terminal afterwards. WebView2 ships with Windows 11.
3. Clone and set the identity **repo-locally** (never globally):
   ```
   git clone https://github.com/engineerlish/programish.git
   cd geeked
   git config user.name engineerlish
   git config user.email 143038945+engineerlish@users.noreply.github.com
   git config core.autocrlf false
   git checkout feat/ide-shell
   ```
   If Prettier reports line-ending warnings on a fresh clone, run (clean tree only):
   `git rm --cached -r . -q; git reset --hard`. `.gitattributes` forces LF.
4. `pnpm install`, then `pnpm dev` (the first Rust build takes several minutes).
   If you move the folder, `pnpm install` needs `CI=true` to rebuild `node_modules` without a TTY.
5. `gh auth login` for PRs. A Claude Code login is needed to chat (`claude` then `/login`).

Checks: `pnpm check` (format, lint, typecheck, tests). Browser-only UI: `pnpm dev:web` (no bridge,
so no chat). Screenshots/e2e need Chrome: set `E2E_CHROMIUM` and run `node apps/desktop/e2e/ide.mjs`
after `pnpm --filter @geeked/bridge build`.

## Git rules reminder

Commits authored only by `engineerlish`, no Claude attribution anywhere, Conventional Commits,
branch per topic, squash-merge PRs, never force-push `main`. Verify each commit with
`git log -1 --format='%an <%ae>%n%B'`.
