# macOS

How Command Center runs and ships on a Mac, what is verified, and how to add Developer ID signing
and notarisation later. Apple Silicon is the primary target; Intel Macs compile (CI checks the
Rust code on `macos-14`, and `x86_64-apple-darwin` builds locally) but are not tested.

## Build and run from source

Prerequisites: Xcode Command Line Tools (`xcode-select --install`), Homebrew, then:

```bash
brew install gh rustup
rustup-init -y
corepack enable pnpm
```

Homebrew's `rustup` is keg-only: add `export PATH="/opt/homebrew/opt/rustup/bin:$PATH"` to
`~/.zprofile`. Then `pnpm install` and `pnpm dev` open the real window. `pnpm --filter
@command-center/desktop tauri build` produces `Command Center.app` and a `.dmg` under
`apps/desktop/src-tauri/target/release/bundle/`.

To build for Intel on an Apple Silicon Mac, `rustup target add x86_64-apple-darwin` and pass
`--target x86_64-apple-darwin`; the bundled Node and Claude runtime must then be x64 too, which
`scripts/prepare-sidecar.mjs` refuses to fake (it stops with a message naming what is missing).

## The lite build (for your own Mac)

The full app bundles Node (116 MB) and the Claude runtime (230 MB) so it runs anywhere. On a Mac
that already has Node.js 22.12+ and Claude Code installed, a lite build leaves both out:

```bash
COMMAND_CENTER_LITE=1 pnpm --filter @command-center/desktop tauri build
```

(`pnpm sidecar --lite` prepares the same layout without building.) The `.app` drops from about
365 MB to about 10 MB and the dmg from about 142 MB to under 6 MB. At launch the app finds `node`
and `claude` the way your login shell would (Homebrew, npm, nvm, volta, fnm, `~/.local/bin`), even
when opened from the Dock, and tells you what to install if either is missing. The installed
Claude Code should be close to the version the bundled SDK expects; if chats fail after a Claude
Code update, use the full build until the app is updated. Releases always ship the full build.

## Lighter at run time

- **Bridge on demand:** the Node bridge starts on the first chat, provider check or usage request,
  not at launch, and the splash no longer waits for it. It stops after 10 minutes without a
  request (Settings > System > "Stop the AI helper when idle": Never, 5, 10, 30 or 60 minutes) and
  starts again on the next request.
- **Battery and Low Power Mode:** with "Lighter on battery" on (Settings > Performance, the default), the tier is capped at Light on battery and Lightest in Low Power
  Mode; it is read from `pmset` once a minute.
- **Animations pause** while the window is hidden, minimized or covered, and the lock-screen
  backdrop runs on a timer at the tier's frame rate instead of every display frame.
- **Release binary:** LTO, one codegen unit, stripped symbols and size optimisation (18 MB to 9 MB).

`node scripts/measure-macos.mjs "<Command Center.app>" [dmg]` reports the sizes, cold start, idle
memory and idle CPU used in the Phase B pull request.

## First launch of the unsigned app (Gatekeeper)

The release dmg is not signed with a Developer ID, so macOS blocks it the first time:

- Right-click (or Control-click) **Command Center** in Applications, choose **Open**, then **Open**
  again in the dialog. Later launches open normally.
- Or, in Terminal: `xattr -dr com.apple.quarantine "/Applications/Command Center.app"`.

On macOS 15 and later the dialog may only offer **Done**: open **System Settings > Privacy &
Security**, scroll to the message about Command Center and choose **Open Anyway**.

## What is macOS-specific

| Area             | macOS behaviour                                                                                                                                                                                                                                      | Where                                           |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Window           | Native traffic lights over the toolbar (`titleBarStyle: Overlay`, hidden title); the custom window buttons are hidden and the toolbars leave room at the left.                                                                                       | `tauri.macos.conf.json`, `lib/window-chrome.ts` |
| Menu bar         | App menu (About, Settings ⌘,, Services, Hide, Quit), Edit (so copy and paste reach the webview) and Window.                                                                                                                                          | `system.rs` `build_app_menu`                    |
| Tray             | A template (monochrome) `>_` icon that macOS tints for light and dark menu bars. Regenerate with `node scripts/tray-icon.mjs`.                                                                                                                       | `icons/tray-template*.png`                      |
| Close            | Follows the System setting: "Keep running in the tray" hides the window, and clicking the Dock icon brings it back. Quit (⌘Q) always quits.                                                                                                          | `system.rs`                                     |
| Start at login   | A LaunchAgent (`tauri-plugin-autostart`, `MacosLauncher::LaunchAgent`).                                                                                                                                                                              | `lib.rs`                                        |
| Sign-in          | Codex, Grok and Claude sign-in open Terminal.app (iTerm when the app was started from iTerm) through `osascript`; nothing runs in a shell of ours.                                                                                                   | `providers/claude.ts` `openTerminal`            |
| PATH             | Apps opened from the Dock get only the system PATH. The bridge adds the login shell's PATH plus Homebrew, `~/.local/bin`, npm, volta, fnm and nvm folders once, so `claude`, `codex`, `grok`, `node` and `ollama` are found and npm shims find Node. | `providers/process.ts` `ensureGuiPath`          |
| Shortcuts        | `Mod` is ⌘. The QA panel is ⌘⇧Y (⌘⇧Q is the system's Log Out). Nothing else collides with ⌘H, ⌘M, ⌘Q or ⌘,.                                                                                                                                          | `lib/shortcuts.ts`                              |
| API keys         | Keychain (`keyring` apple-native), service `command-center`. The one-time copy from the previous name runs after the window opens, and a denied Keychain prompt is not asked again.                                                                  | `secrets.rs`, `legacy_keys.rs`                  |
| Preview          | The `preview:` scheme loads as `preview://localhost/<id>` in WKWebView; the CSP `frame-src preview:` covers it.                                                                                                                                      | `preview.rs`, `PreviewFrame.tsx`                |
| Bundled binaries | `node` and `claude` are made executable, ad-hoc signed and stripped of quarantine when bundled.                                                                                                                                                      | `scripts/prepare-sidecar.mjs`                   |

## Adding Developer ID signing and notarisation later

Nothing below is set up; no signing secrets are in the repository.

1. Join the Apple Developer Program and create a **Developer ID Application** certificate. Export
   it with its private key as a `.p12`.
2. Add repository secrets: `APPLE_CERTIFICATE` (the `.p12`, base64), `APPLE_CERTIFICATE_PASSWORD`,
   `APPLE_SIGNING_IDENTITY` (for example `Developer ID Application: Your Name (TEAMID)`), and for
   notarisation either `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`,
   or an App Store Connect API key (`APPLE_API_ISSUER`, `APPLE_API_KEY`, `APPLE_API_KEY_PATH`).
3. In the `macos` job of `.github/workflows/release.yml`, import the certificate into a temporary
   keychain before `tauri build` and pass those secrets as environment variables; Tauri's bundler
   signs and notarises when they are present (Tauri's "macOS code signing" guide lists the exact
   variable names for the installed version).
4. The bundled `node` and `claude` must then be signed with the same identity and the hardened
   runtime, with entitlements Node needs for its JIT (`com.apple.security.cs.allow-jit`,
   `com.apple.security.cs.allow-unsigned-executable-memory`, and
   `com.apple.security.cs.disable-library-validation` for native modules). Replace the ad-hoc
   `codesign --sign -` in `prepare-sidecar.mjs` with the identity and an entitlements file, and set
   `bundle.macOS.entitlements` for the app.
5. Drop the Gatekeeper steps from the README once a notarised build ships.

## Not verified here

- Notarisation (no Developer ID).
- Intel Macs at run time.
- Anything only a person can see: traffic lights, the menu bar, the tray icon, Terminal sign-in,
  the Keychain prompt, Gatekeeper and start at login. These are QA items `MAC-01` to `MAC-09` in
  `docs/TESTING.md`.
