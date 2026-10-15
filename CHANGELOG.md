# Changelog

All notable changes to Geeked (called Programish until 1.1.0) are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- The app is now called **Geeked** (it was Programish): window title, installer, executable
  (`geeked.exe`), workspace packages (`@geeked/*`), Rust crate, environment variables
  (`GEEKED_*`) and export file names. Prompt libraries exported under the old name still import.
- The bundle identifier is now `com.engineerlish.geeked`, which moves the app data folder. On
  the first start Geeked copies the database and the saved settings (theme, layout, PIN lock)
  from the old location, verifies every file, and only then records the migration. The old
  data is never deleted or modified; remove it yourself once you are satisfied. A new installer
  installs beside the old Programish app, which you can uninstall afterwards.

### Added

- An editor-style layout: threads grouped by project in an explorer, the code Claude writes as
  tabbed files with versions, diffs and live preview, the conversation docked as an assistant
  panel, an activity panel with per-reply usage, and a status bar with model, context fill and
  plan headroom. The original layout is still available from the command palette.
- An animated ASCII landing page that asks for a PIN you choose on first launch, locks on demand
  (`Ctrl+L`) and after inactivity, and waits longer after repeated wrong PINs. Set, change or remove
  the PIN and the idle timeout in Settings. It keeps casual access out; it does not encrypt your
  chats on disk.

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

[Unreleased]: https://github.com/engineerlish/programish/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/engineerlish/programish/releases/tag/v1.0.0
