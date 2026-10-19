# Changelog

All notable changes to Command Center (called Geeked until 1.1.0, and Programish before that) are
recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Business plans can be read wide: hide the plan list (remembered), or press **Read full width** to
  hide the list, the explorer, the assistant and the preview panel at once; pressing it again or leaving the view puts
  them back.
- **Business plans** (the briefcase in the left rail, or "Open business plans" in the palette): read
  your own plans, such as the Short-Let Launch Plan artifact, inside Command Center. Add one from an
  HTML file; plans stay in the local database on your computer, open in the same sandbox as code
  previews (their calculators and in-page links work; external links do not open), and can be
  renamed, reordered and removed.
- **Model Lab** (rail icon, or "Open Model Lab" in the palette): add models from Hugging Face by
  searching the Hub, pasting a link, or picking a `.gguf` file or MLX folder already on your Mac,
  then run them in the **Hugging Face cloud** (Inference Providers, with your own token kept in the
  Keychain) or **on this computer** with Ollama, llama.cpp, MLX-LM or LM Studio. Local models show
  the exact command with Copy and Run in Terminal; Command Center never downloads or runs weights
  itself. Warnings for gated, non-chat and too-large models; per-model presets (temperature, top P,
  top K, max tokens, stop, repetition penalty), a default system prompt and an MLX adapter folder; a
  side-by-side test showing time to first text, tokens per second and tokens, with Save to
  conversation.
- Per-chat presets: Chat settings > Presets for this chat overrides a Model Lab model's temperature,
  top P and max tokens for one conversation; Settings > AI agents > Model presets edits each model's
  presets.
- Settings > AI agents: a Hugging Face card for the token and an "On this computer" card showing
  each runtime as installed or running, with "Allow remote model servers" (off: localhost only).

- **A lite build for your own Mac** (`COMMAND_CENTER_LITE=1`): about 10 MB instead of 365 MB,
  using the Node.js and Claude Code already installed, with a clear message if either is missing.
- **Settings > System > "Stop the AI helper when idle"** (default 10 minutes) and
  **Settings > Performance > "Lighter on battery"** (on by default: Light on battery, Lightest in
  Low Power Mode).

- **macOS support** (Apple Silicon first): a `.dmg` for each release, native traffic lights over the
  toolbar, the standard menu bar (About, Settings ⌘,, Hide, Quit, Edit and Window), a monochrome
  menu-bar icon, the Dock icon reopening a window kept in the tray, start at login through a
  LaunchAgent, and the Keychain for API keys. See `docs/macos.md` for the first-launch Gatekeeper steps.
- Sign-in buttons for Claude, ChatGPT (Codex) and Grok open Terminal on macOS (iTerm when the app
  was started from it).
- On macOS the app finds `claude`, `codex`, `grok`, `node` and `ollama` installed with Homebrew,
  npm, nvm, volta or fnm even when opened from the Dock.
- Shortcut hints show ⌘ and ⇧ on macOS everywhere, not only in the shortcuts list.
- Four Claude Code project subagents (reviewer, tester, ui-polish, regulator) with a permission
  guard hook, a "Subagents" workflow in `CLAUDE.md`, and `docs/prompts/` for the prompts used to
  build Geeked.
- A QA checklist panel (Ctrl+Shift+Q) with one-click setup, Pass/Fail/Skip and prefilled GitHub
  issue reports, a generated `docs/TESTING.md`, issue forms and a PR template.
- Storybook with stories for the UI, a toolbar for theme, palette, density, motion and tier, and
  an MCP server for Claude; a design-token export for Figma.
- A launch splash with the spinning 3D ASCII logo, and PIN entry on eight circles with a reveal
  toggle (the circles are the input; a hidden field takes the typing). Home keeps a still logo.
- Provider status dots and new-model notices, read from the public
  [geeked-ai-status](https://github.com/engineerlish/geeked-ai-status) feed (cached, works
  offline), with a link to the status history in Settings.
- First-run onboarding: name, PIN, system behavior, performance tier and appearance, and AI
  agent connections. Every choice has a matching section in Settings, and "Re-run onboarding"
  starts the flow again.
- A Home screen with the Geeked logo, a rotating launch message (greetings, quips and stats) and
  a spinning 3D ASCII logo whose frame rate follows the performance tier.
- Five performance tiers (Lightest to Accelerated) that map to typed feature flags, plus theme
  (dark, light, system), six color palettes with an accent picker, animation level, density and
  font size.
- PINs of 4 to 8 letters, numbers or symbols, hashed with Argon2id, with attempt delays that
  survive restarts.
- Start with Windows, and minimize to a tray icon (Open, New chat, Lock, Quit) on close.
- A provider abstraction with ChatGPT (through the official Codex CLI) and Grok (xAI API key or
  the Grok CLI) beside Claude, a provider and model picker per chat, and API keys kept in the
  Windows Credential Manager. See `docs/providers.md`.
- An editor-style layout: threads grouped by project in an explorer, the code Claude writes as
  tabbed files with versions, diffs and live preview, the conversation docked as an assistant
  panel, an activity panel with per-reply usage, and a status bar with model, context fill and
  plan headroom. The original layout is still available from the command palette.
- An animated ASCII landing page that asks for a PIN you choose on first launch, locks on demand
  (`Ctrl+L`) and after inactivity, and waits longer after repeated wrong PINs. Set, change or remove
  the PIN and the idle timeout in Settings. It keeps casual access out; it does not encrypt your
  chats on disk.

### Changed

- When a local model's engine crashes (for example Ollama running out of memory), the chat now
  says so and tells you to restart Ollama from the menu bar, instead of pointing at a terminal
  window.
- Command Center opens faster and uses less memory: the background bridge starts on the first
  chat or provider check instead of at launch, the splash no longer waits for it, and it stops
  after a quiet period. Idle CPU on the lock and onboarding screens is about halved (the backdrop
  no longer redraws on every display frame), and the release app binary is half the size.
- The QA checklist panel opens with ⌘⇧Y on macOS (⌘⇧Q is the system's Log Out); it stays Ctrl+Shift+Q
  elsewhere.

- **Renamed to Command Center** (from Geeked). The window, menus, tray, installer and docs use the
  new name; the bundle identifier is now `com.milesceo.commandcenter`, the database
  `command-center.db`, the credential-store service `command-center`, packages `@command-center/*`
  and environment variables `COMMAND_CENTER_*`. The repository moved to `milesceo/command-center`.
- **Your data moves automatically** on the first launch after updating, from a Geeked install or
  straight from a Programish one: chats and everything else in the database, preferences and the
  PIN lock (including its lockout state), the close-to-tray choice and stored API keys are copied
  to the new locations and verified. Nothing under the old name is modified or deleted, and an
  existing file under the new name is never overwritten.
- Prompt libraries exported as Geeked or Programish files still import.
- Command Center installs **beside** Geeked rather than over it. Once your data is here, turn off
  Geeked's "start at login", quit it from the tray and uninstall it. If Geeked is still running
  when Command Center first starts, nothing is copied and Command Center asks you to quit Geeked
  and start again (or to start without the old data).
- Erasing data in Command Center ("Forgot PIN", or clearing data in Settings) erases only Command
  Center's own copy. The previous install's folder and its stored API keys stay until you
  uninstall the previous version.
- The app is now called **Geeked** (it was Programish): window title, installer, executable
  (`geeked.exe`), workspace packages (`@geeked/*`), Rust crate, environment variables
  (`GEEKED_*`) and export file names. Prompt libraries exported under the old name still import.
- The bundle identifier is now `com.engineerlish.geeked`, which moves the app data folder. On
  the first start Geeked copies the database and the saved settings (theme, layout, PIN lock)
  from the old location, verifies every file, and only then records the migration. The old
  data is never deleted or modified; remove it yourself once you are satisfied. A new installer
  installs beside the old Programish app, which you can uninstall afterwards.

### Deprecated

- The `GEEKED_*` environment variables (`GEEKED_BRIDGE_ENTRY`, `GEEKED_CLAUDE_EXECUTABLE`,
  `GEEKED_QUERY_MODULE`) still work for one release and print a warning; use `COMMAND_CENTER_*`.

## [1.0.0] - 2026-10-14

First release. Programish is the Claude client I wanted for day-to-day coding: small, fast, and
built around code. It runs on your own Claude Code login, so there is no API key and no separate
bill.

### Added

- Streaming chat on your Claude subscription, with a Stop button that keeps the partial reply, a
  model picker (Default, Sonnet, Opus, Haiku) and a system prompt per conversation.
- Plain chat by default. Optional read-only file access (Read, Glob, Grep) for one folder you pick.
- Conversations saved locally in SQLite: rename, pin, delete with confirmation, and search by title
  or message text. Edit and resend an earlier message, or regenerate the last reply. Attach text
  files by picking, pasting or dropping them.
- Code blocks highlighted with Shiki in a theme that follows light and dark, with line numbers,
  collapse, wrap, copy, save as file and open in preview.
- Diffs in replies render side by side or inline with changed words marked. Compare any two code
  blocks, or a block with its earlier version.
- A live preview panel for HTML, SVG, Mermaid and Markdown. Previews run sandboxed with no access to
  the app, your files or the network, and update while a reply streams. Tabs, refresh, three viewport
  widths and a console pane.
- Usage tracking from the numbers the SDK reports: tokens (input, output, cache read, cache write)
  per reply, running totals in the chat header, and a Usage view with daily and weekly charts, a
  per-model breakdown and your most expensive conversations. Cost is shown as "API-equivalent cost",
  which is informational on a subscription and not a bill. Plan headroom and reset times appear when
  your login reports them.
- A prompt library for prompts and system prompts, with tags and `{{variables}}` filled in through a
  small form. Type `/` in the message box to search and insert. Import and export as JSON.
- Projects to group conversations, each with an optional default system prompt.
- A command palette on `Ctrl+K` for actions, switching conversation, inserting a prompt, toggling
  panels and changing the model.
- A settings view: theme, interface size, code font size, default model and system prompt for new
  chats, where your data lives, export everything as JSON, and clear usage, the library or all data
  after a confirmation.
- Keyboard shortcuts, listed with `Ctrl+/`.
- A Windows installer that bundles everything the app needs: the bridge, a Node runtime and the
  Claude runtime. It installs per user and needs no developer tools. You only need to have logged in
  to Claude Code once.

### Changed

- Secondary views (Usage, Prompts, Settings) load on first visit, which trims the startup bundle.
- Muted text is darker in light mode and lighter in dark mode so every label meets WCAG AA contrast.
- Dialogs keep keyboard focus inside them and give it back when they close.

### Known limitations

- The installer is not code signed, so Windows SmartScreen shows a warning on first run. Choose
  "More info", then "Run anyway".
- A reply you stop part-way has no usage recorded, because the SDK sends none for it.
- Plan headroom depends on what your login exposes. If it reports nothing, the app says so instead
  of guessing.
- Windows 11 on x64 is the supported target. Other platforms build from source but are untested.

[Unreleased]: https://github.com/milesceo/command-center/commits/main
[1.0.0]: https://github.com/engineerlish/geeked/releases/tag/v1.0.0
