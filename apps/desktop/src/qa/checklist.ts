// The manual test checklist. This file is the single source of truth: the in-app QA panel reads
// it, `pnpm qa:docs` renders it to docs/TESTING.md, and failed items become GitHub issues.
//
// It must stay dependency-free (no imports) so the docs script can load it with plain Node.
//
// Add an item only for something automation cannot confirm. When a step changes meaning, bump
// the item's `rev` so an old result is not carried over to a different question.

export const QA_AREAS = [
  'splash-home',
  'lock',
  'onboarding',
  'shell',
  'appearance',
  'providers',
  'status',
  'migration',
  'macos',
  'performance',
  'models',
  'plans',
] as const;
export type QaArea = (typeof QA_AREAS)[number];

export const AREA_LABELS: Record<QaArea, string> = {
  'splash-home': 'Splash and Home',
  lock: 'PIN and lock',
  onboarding: 'Onboarding',
  shell: 'Window, tray and startup',
  appearance: 'Appearance and performance',
  providers: 'Providers and keys',
  status: 'Status feed',
  migration: 'Rename and data migration',
  macos: 'macOS',
  performance: 'Lighter runtime',
  models: 'Model Lab',
  plans: 'Business plans',
};

/** What a scenario button in the panel can do for you (see `scenarios.ts`). */
export const SCENARIO_IDS = [
  'go-home',
  'restart-onboarding',
  'open-settings-security',
  'open-settings-agents',
  'open-model-lab',
  'open-business-plans',
  'open-settings-system',
  'open-settings-appearance',
  'tier-lightest',
  'tier-balanced',
  'tier-accelerated',
  'simulate-new-model',
  'simulate-claude-degraded',
  'reload-app',
] as const;
export type ScenarioId = (typeof SCENARIO_IDS)[number];

/** `any`: works anywhere. The others say what the test needs that CI and I cannot provide. */
export type QaNeeds = 'any' | 'windows-desktop' | 'mac-desktop' | 'real-login' | 'network';

export interface QaItem {
  /** `AREA-NN`, unique and stable. */
  id: string;
  area: QaArea;
  title: string;
  /** Short numbered steps; each is one action. */
  steps: string[];
  /** What should be true afterwards. */
  expected: string;
  needs: QaNeeds;
  /** Optional one-click setup in the panel. */
  setup?: ScenarioId;
  /** Bump when the question changes so old results are ignored. */
  rev: number;
  /** True when running it can erase data or change real settings. */
  destructive?: boolean;
}

export const CHECKLIST_VERSION = 1;

export const QA_ITEMS: readonly QaItem[] = [
  // ---------------------------------------------------------------- splash and Home
  {
    id: 'SPLASH-01',
    area: 'splash-home',
    title: 'Splash appears at once and hands off cleanly',
    steps: [
      'Quit Command Center completely (tray: Quit, or close the window).',
      'Start it again from the shortcut.',
      'Watch the first second.',
    ],
    expected:
      'The spinning COMMAND logo, with "command center" set under it, is on screen almost immediately (no blank white or black flash), stays about a second, then fades into the PIN lock (or Home with no PIN) with no layout jump.',
    needs: 'windows-desktop',
    setup: 'reload-app',
    rev: 2,
  },
  {
    id: 'SPLASH-02',
    area: 'splash-home',
    title: 'Logo frame rate follows the performance tier',
    steps: [
      'Press "Set up" to switch to the Lightest tier, then reload.',
      'Look at the splash logo.',
      'Switch to Accelerated and reload again.',
    ],
    expected:
      'Lightest shows one still frame; Accelerated spins noticeably faster and smoother than Balanced.',
    needs: 'windows-desktop',
    setup: 'tier-lightest',
    rev: 1,
  },
  {
    id: 'HOME-01',
    area: 'splash-home',
    title: 'Home has a still logo and a different line each launch',
    steps: [
      'Open Home (the house icon).',
      'Note the top-left logo and the line under the Command Center mark.',
      'Restart the app twice and note the line each time.',
    ],
    expected:
      'The top-left logo never moves; the center mark stays; the line is different on each launch and uses your name or real stats when it can.',
    needs: 'windows-desktop',
    setup: 'go-home',
    rev: 1,
  },

  // ---------------------------------------------------------------------- PIN and lock
  {
    id: 'LOCK-01',
    area: 'lock',
    title: 'The circles take typing, paste and Backspace',
    steps: [
      'Set a PIN in Settings if none exists, then lock with Ctrl+L.',
      'Without clicking anything, type a mix of letters, numbers and symbols.',
      'Press Backspace twice, then paste a 6-character PIN with Ctrl+V.',
      'Check the Unlock button with fewer than 4 characters typed.',
    ],
    expected:
      'Characters fill the circles as you type; Backspace removes them; paste fills up to 8; no text field is visible; Unlock is disabled under 4 characters and Enter unlocks with the right PIN.',
    needs: 'windows-desktop',
    setup: 'open-settings-security',
    rev: 1,
  },
  {
    id: 'LOCK-02',
    area: 'lock',
    title: 'Reveal shows characters in the circles and resets',
    steps: [
      'On the lock screen type 4 or more characters.',
      'Click the eye button, then click it again.',
      'Unlock, lock again with Ctrl+L.',
    ],
    expected:
      'Revealed circles show the real characters in the mono font; hidden shows dots; after locking again the reveal is off.',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'LOCK-03',
    area: 'lock',
    title: 'A wrong PIN shakes, clears and slows down',
    steps: [
      'On the lock screen enter a wrong PIN and press Enter, five times.',
      'Try the right PIN during the countdown.',
      'Wait for the countdown to end and enter the right PIN.',
    ],
    expected:
      'Each wrong PIN shakes and clears the circles; after the fifth a "Locked for 30s" countdown shows and even the right PIN is refused until it ends; then it unlocks.',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'LOCK-04',
    area: 'lock',
    title: 'A PIN from an earlier version still unlocks (once)',
    steps: [
      'Only if you set a PIN before the Argon2id change and have not unlocked since.',
      'Start Command Center and enter the old PIN.',
      'Lock and unlock again.',
    ],
    expected:
      'The old PIN unlocks the first time and keeps working afterwards (it was upgraded in place); nothing asks you to set a new one.',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'LOCK-05',
    area: 'lock',
    title: 'Forgot PIN erases everything and restarts setup',
    steps: [
      'Make a throwaway chat first (this test erases local data).',
      'On the lock screen click "forgot PIN?".',
      'Read the warning, type DELETE, press "Erase and reset".',
    ],
    expected:
      'The warning says nothing can be recovered; Erase stays disabled until DELETE is typed; afterwards the app restarts into onboarding with no chats and no PIN.',
    needs: 'windows-desktop',
    destructive: true,
    rev: 1,
  },

  // --------------------------------------------------------------------- onboarding
  {
    id: 'ONB-01',
    area: 'onboarding',
    title: 'The whole flow works from the keyboard',
    steps: [
      'Press "Set up" to restart onboarding.',
      'Complete every step using only Tab, Enter, Space and arrow keys.',
    ],
    expected:
      'Every control is reachable and visibly focused; Enter continues; the step list responds to arrow keys; you land on Home.',
    needs: 'windows-desktop',
    setup: 'restart-onboarding',
    rev: 1,
  },
  {
    id: 'ONB-02',
    area: 'onboarding',
    title: 'Name rules are clear',
    steps: ['On the name step enter only spaces, then 33 characters, then " Ada ".'],
    expected:
      'Next stays disabled with a clear message for the first two; " Ada " is saved as "Ada" and used in greetings.',
    needs: 'any',
    setup: 'restart-onboarding',
    rev: 1,
  },
  {
    id: 'ONB-03',
    area: 'onboarding',
    title: 'The preview card matches the real app',
    steps: [
      'On the Performance and appearance step pick a palette, an accent, Compact density and a larger font.',
      'Finish onboarding and look at the explorer and text size.',
    ],
    expected:
      'The preview card reflected each change as you made it, and the app looks the same way afterwards.',
    needs: 'windows-desktop',
    setup: 'restart-onboarding',
    rev: 1,
  },

  // ------------------------------------------------------ window, tray and startup
  {
    id: 'SHELL-01',
    area: 'shell',
    title: 'Resizing from the edges and corners works',
    steps: [
      'Drag each edge and each corner of the window.',
      'Try to make it smaller than the minimum.',
    ],
    expected: 'All eight handles resize; the window stops at 720 by 480.',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'SHELL-02',
    area: 'shell',
    title: 'Window buttons and toolbar behave',
    steps: [
      'Use minimize, maximize and close at the top right.',
      'Double-click an empty part of the toolbar.',
      'Drag the toolbar.',
    ],
    expected:
      'Buttons are in the order minimize, maximize, close; double-click toggles maximize; dragging moves the window.',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'SYS-01',
    area: 'shell',
    title: 'Tray icon and menu',
    steps: [
      'Open Settings > System and set "When I close the window" to Minimize to tray.',
      'Find the Command Center icon in the system tray.',
      'Right-click it and try Open, New chat, Lock, then Quit.',
    ],
    expected:
      'The icon is there; Open shows the window; New chat opens a new thread; Lock shows the PIN screen; Quit exits completely.',
    needs: 'windows-desktop',
    setup: 'open-settings-system',
    rev: 1,
  },
  {
    id: 'SYS-02',
    area: 'shell',
    title: 'Close to tray hides and locks',
    steps: [
      'With a PIN set and Minimize to tray on, click the window close button.',
      'Open Command Center again from the tray icon.',
    ],
    expected:
      'The window hides (the app keeps running in the tray) and, when shown again, asks for the PIN.',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'SYS-03',
    area: 'shell',
    title: 'Start with Windows',
    steps: [
      'Turn on "Launch Command Center when Windows starts".',
      'Open Task Manager > Startup apps and look for Command Center.',
      'Sign out and back in (or restart).',
      'Turn the setting off again and check Task Manager.',
    ],
    expected:
      'Command Center appears in Startup apps when on and starts after signing in; it is gone from the list when off.',
    needs: 'windows-desktop',
    setup: 'open-settings-system',
    rev: 1,
  },

  // ------------------------------------------------------------ appearance and tiers
  {
    id: 'APPEAR-01',
    area: 'appearance',
    title: 'Theme "System" follows Windows live',
    steps: [
      'Set Theme to System in Settings > Appearance.',
      'Switch Windows between light and dark mode (Settings > Personalization > Colors).',
    ],
    expected: 'Command Center switches theme without a restart.',
    needs: 'windows-desktop',
    setup: 'open-settings-appearance',
    rev: 1,
  },
  {
    id: 'APPEAR-02',
    area: 'appearance',
    title: 'Palette and accent read well everywhere',
    steps: [
      'Try each palette and a custom accent in both themes.',
      'Visit chat, Settings, the lock screen and a dialog.',
    ],
    expected: 'Text stays readable and the accent is used consistently; nothing looks washed out.',
    needs: 'windows-desktop',
    setup: 'open-settings-appearance',
    rev: 1,
  },
  {
    id: 'APPEAR-03',
    area: 'appearance',
    title: 'Animation setting is respected',
    steps: [
      'Set Animations to Off, reload, and look at the splash, a wrong PIN and Home.',
      'Set it to Reduced and compare.',
    ],
    expected: 'Off: no shake, no fades and a still logo. Reduced: short fades and a slower logo.',
    needs: 'windows-desktop',
    setup: 'open-settings-appearance',
    rev: 1,
  },

  // -------------------------------------------------------------- providers and keys
  {
    id: 'PROV-01',
    area: 'providers',
    title: 'Claude is detected automatically',
    steps: ['Make sure you are signed in to Claude Code.', 'Open Settings > AI agents.'],
    expected: 'The Claude card says Connected without any action from you.',
    needs: 'real-login',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'PROV-02',
    area: 'providers',
    title: 'A Grok API key lands in Credential Manager and works',
    steps: [
      'In Settings > AI agents paste an xAI API key on the Grok card and save.',
      'Open Windows Credential Manager > Windows Credentials and look for a "command-center" entry.',
      'Start a chat with Grok.',
      'Remove the key in Command Center and check Credential Manager again.',
    ],
    expected:
      'An entry named api-key:xai under the command-center service appears and is gone after Remove; the chat answers; the key never shows in any file or in the database.',
    needs: 'real-login',
    setup: 'open-settings-agents',
    rev: 2,
  },
  {
    id: 'PROV-03',
    area: 'providers',
    title: 'ChatGPT sign-in through the Codex CLI',
    steps: [
      'Needs real Codex and Claude logins. Install the Codex CLI (npm i -g @openai/codex) if needed.',
      'On the ChatGPT card click "Sign in with ChatGPT CLI" and finish in the terminal window.',
      'Start a chat with ChatGPT.',
    ],
    expected: 'The card turns Connected within a few seconds and the chat answers.',
    needs: 'real-login',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'PROV-04',
    area: 'providers',
    title: 'Grok CLI sign-in (beta)',
    steps: [
      'Install the Grok CLI and run its sign-in from the Grok card.',
      'Remove any stored Grok key, then start a Grok chat.',
    ],
    expected:
      'Replies stream as plain text; the card says the CLI route is beta and gives no token counts.',
    needs: 'real-login',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'PROV-05',
    area: 'providers',
    title: 'Provider and model are remembered per chat',
    steps: [
      'Enable two providers, start a chat on one and pick a model in the chat header.',
      'Start another chat on a different provider.',
      'Reopen the first chat.',
    ],
    expected: 'Each chat keeps its own provider and model.',
    needs: 'real-login',
    rev: 1,
  },

  // ------------------------------------------------------------------ status feed
  {
    id: 'STATUS-01',
    area: 'status',
    title: 'Status dots reflect the live feed',
    steps: [
      'Open Settings > AI agents and wait a few seconds.',
      'Click a status dot, then "Incident details" if there is one.',
      'Click "View status history".',
    ],
    expected:
      'Each provider has a coloured dot matching its real state; the popover shows the summary and when it was checked; links open in your browser.',
    needs: 'network',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'STATUS-02',
    area: 'status',
    title: 'Offline falls back to the cached copy',
    steps: [
      'Let the app load the feed once, then quit it.',
      'Turn off your network (airplane mode) and start Command Center.',
      'Click a status dot.',
    ],
    expected:
      'Dots still show the last known state and the popover says "Offline: showing the copy from ...".',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'STATUS-03',
    area: 'status',
    title: 'A new-model notice appears, dismisses and offers the model',
    steps: [
      'Press "Set up" to simulate a new Claude model.',
      'Dismiss the notice.',
      'Open the model picker in the chat header.',
    ],
    expected: 'One notice appears; it dismisses; the new model is in the Claude model list.',
    needs: 'any',
    setup: 'simulate-new-model',
    rev: 1,
  },
  {
    id: 'STATUS-04',
    area: 'status',
    title: 'A degraded provider turns its dot amber',
    steps: [
      'Press "Set up" to simulate a degraded Claude.',
      'Look at the picker dot and click it.',
    ],
    expected: 'The dot is amber and the popover lists the simulated incident.',
    needs: 'any',
    setup: 'simulate-claude-degraded',
    rev: 1,
  },
  // ---------------------------------------------------------------- rename and data migration
  {
    id: 'MIGRATE-01',
    area: 'migration',
    title: 'An install from before the rename opens with everything intact',
    steps: [
      'On a machine that has the previous version installed and used (a few chats, a project, a library prompt, a PIN, a non-default theme and tier, close-to-tray on), note what you see, then quit it.',
      'Install and start Command Center.',
      'Unlock with the old PIN.',
      'Check the chats, projects and prompt library, Settings > Appearance, Settings > System, and the Usage view.',
      'Open the data folder (Settings > About) and look for migrated-from-previous-name.json.',
    ],
    expected:
      'The old PIN unlocks (and a lockout that was running continues); every chat, project, prompt and usage row is there; theme, tier, layout and the close choice are as before; the marker file lists the copied files; the previous version, started again, still has all of its own data.',
    needs: 'windows-desktop',
    rev: 1,
  },
  {
    id: 'MIGRATE-02',
    area: 'migration',
    title: 'Stored API keys carry over to the new credential service',
    steps: [
      'Before updating, store a Grok (xAI) API key in the previous version.',
      'Start Command Center once and open Settings > AI agents.',
      'Open the OS credential store (Windows Credential Manager, or Keychain Access on macOS) and search for api-key:xai.',
      'Send one Grok chat.',
    ],
    expected:
      'The Grok card shows the key as stored; the credential store has an api-key:xai entry under the command-center service and the old entry is still there; the chat answers. On macOS, any Keychain prompt names Command Center.',
    needs: 'real-login',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'MIGRATE-03',
    area: 'migration',
    title: 'A conflicting file under the new name is never overwritten',
    steps: [
      'With the previous version installed, start Command Center once (so it has its own database), add a chat, quit.',
      'Delete only migrated-from-previous-name.json from the Command Center data folder.',
      'Start Command Center again.',
    ],
    expected:
      'Command Center opens on its own data (the new chat is there), nothing from the previous version overwrote it, the marker is not rewritten, and the log says the migration did not complete.',
    needs: 'windows-desktop',
    destructive: true,
    rev: 1,
  },
  {
    id: 'MIGRATE-04',
    area: 'migration',
    title: 'A PIN removed in the previous version stays removed',
    steps: [
      'In the previous version, remove the PIN (Settings > Security), then quit it.',
      'Start Command Center, then quit and start it again.',
      'In Command Center, set a PIN, remove it again, quit and restart; then repeat with Forgot PIN.',
    ],
    expected:
      'Command Center never asks for a PIN that was removed, on the first start or later ones; after Forgot PIN the app starts at onboarding and no old PIN comes back.',
    needs: 'windows-desktop',
    destructive: true,
    rev: 1,
  },
  {
    id: 'MIGRATE-05',
    area: 'migration',
    title: 'With the previous version still running, nothing is copied half-way',
    steps: [
      'Leave the previous version running (hidden in the tray).',
      'Start Command Center for the first time.',
      'In the message box, choose Quit. Quit the previous version from its tray icon and start Command Center again.',
    ],
    expected:
      'A message box explains the previous version is still running before any window opens; after Quit no Command Center data folder content exists yet; the second start copies everything (MIGRATE-01 holds).',
    needs: 'windows-desktop',
    rev: 1,
  },
  // ---------------------------------------------------------------- macOS
  {
    id: 'MAC-01',
    area: 'macos',
    title: 'Native traffic lights and a draggable title bar',
    steps: [
      'Start Command Center on a Mac (editor layout).',
      'Look at the top-left corner, then drag the empty part of the toolbar.',
      'Switch to the classic layout (palette: "Use classic layout") and look again; then lock the app and look at the lock screen; re-run onboarding and look at its top strip; enter full screen.',
    ],
    expected:
      'The red, yellow and green buttons are the system ones, vertically centered in the toolbar, with the sidebar button just to their right and nothing under them; no second set of buttons appears at the right; dragging the toolbar moves the window; the classic title and the command pill are centred; green zooms and full-screens as usual (in full screen an empty strip remains where the buttons were).',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'MAC-02',
    area: 'macos',
    title: 'The menu bar works like a Mac app',
    steps: [
      'Open the Command Center menu: About Command Center, then Settings… (also try Cmd+,).',
      'Type in the composer, select the text, and use Edit > Copy, Edit > Paste, Undo (Cmd+Z) and Select All.',
      'Use Hide Command Center (Cmd+H), bring it back from the Dock, then Window > Minimize (Cmd+M).',
    ],
    expected:
      'About names Command Center and its version; Settings opens the Settings view; copy, paste, undo and select all work in text fields; Hide, Minimize and Dock restore behave normally; Cmd+Q quits.',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'MAC-03',
    area: 'macos',
    title: 'Menu-bar icon, close to tray and Dock reopen',
    steps: [
      'Look for the >_ icon in the menu bar, in both light and dark menu bars (System Settings > Appearance).',
      'Click it and use Open, New chat and Lock.',
      'In Settings > System choose "Minimize to menu bar", close the window with the red button, then click the Dock icon.',
    ],
    expected:
      'The icon is monochrome and readable in both appearances; its menu works; closing hides the window and locks the app; clicking the Dock icon shows the window again (asking for the PIN if one is set).',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'MAC-04',
    area: 'macos',
    title: 'Sign-in opens Terminal',
    steps: [
      'Needs real Codex and Claude logins. Install the Codex CLI (npm i -g @openai/codex) if needed.',
      'Open Command Center from the Dock (not from a terminal).',
      'In Settings > AI agents, click Sign in on the ChatGPT (Codex) card; repeat for Claude.',
    ],
    expected:
      'Terminal.app comes to the front with a new window already running the sign-in command (codex login, claude auth login); after signing in there, the card turns Connected without restarting the app. If the app was started from iTerm, iTerm is used instead.',
    needs: 'mac-desktop',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'MAC-05',
    area: 'macos',
    title: 'CLIs are found when the app is opened from the Dock',
    steps: [
      'Quit Command Center, then open it from the Dock or Applications (not a terminal).',
      'Open Settings > AI agents.',
    ],
    expected:
      'Claude, and Codex or Grok if installed (Homebrew, npm, nvm, volta or fnm), show as installed or connected exactly as they do when started from a terminal.',
    needs: 'mac-desktop',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'MAC-06',
    area: 'macos',
    title: 'An API key lands in the Keychain',
    steps: [
      'Needs an xAI API key. In Settings > AI agents, paste it on the Grok card and save.',
      'Open Keychain Access and search for api-key:xai.',
      'Send one Grok chat, then remove the key and search again.',
    ],
    expected:
      'An item named api-key:xai with service command-center appears and is gone after Remove; any Keychain prompt names Command Center; the chat answers.',
    needs: 'mac-desktop',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'MAC-07',
    area: 'macos',
    title: 'The downloaded dmg installs and opens',
    steps: [
      'Download the dmg from a release (or the macOS app artifact of a CI run), open it and drag Command Center to Applications.',
      'Open it from Applications; when macOS blocks it, follow the README steps (right-click > Open, or Privacy & Security > Open Anyway).',
      'Send a Claude chat.',
    ],
    expected:
      'After the one-time approval the app opens, starts its bundled bridge (chat works with no Node installed), and later launches open without a warning.',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'MAC-08',
    area: 'macos',
    title: 'Start at login uses a login item',
    steps: [
      'Turn on "Launch Command Center when you log in" in Settings > System.',
      'Open System Settings > General > Login Items, then log out and back in.',
      'Turn it off again and check Login Items.',
    ],
    expected:
      'Command Center is listed (as a background item) while on and starts after logging in; it is gone when off.',
    needs: 'mac-desktop',
    setup: 'open-settings-system',
    rev: 1,
  },
  {
    id: 'MAC-09',
    area: 'macos',
    title: 'Preview, save and shortcuts in WKWebView',
    steps: [
      'Ask for a small HTML page with a script that logs to the console, and open it in the preview.',
      'Save a code block with Save as file.',
      'Open the shortcuts list (Cmd+/) and try Cmd+K, Cmd+B, Cmd+T, Cmd+J, Cmd+L, Cmd+Shift+A and the QA panel (Cmd+Shift+Y); hover a toolbar button and read its tooltip; in the composer press Ctrl+T.',
    ],
    expected:
      'The preview runs and shows its console output; the save dialog writes the file; the shortcut list shows ⌘ glyphs and every listed shortcut works, none of them triggering a system action instead; tooltips show ⌘ glyphs; Ctrl+T in the composer transposes letters instead of opening a thread.',
    needs: 'mac-desktop',
    rev: 1,
  },
  // ---------------------------------------------------------------- lighter runtime
  {
    id: 'PERF-01',
    area: 'performance',
    title: 'The lite build runs on the installed Node and Claude Code',
    steps: [
      'Build it: COMMAND_CENTER_LITE=1 pnpm --filter @command-center/desktop tauri build, and open the .app from Finder (not a terminal).',
      'Send a Claude chat.',
      'Temporarily rename your claude binary (or test on a Mac without Node) and open the app again, then send a chat.',
    ],
    expected:
      'The app is about 10 MB; the chat works with no bundled runtime; with Node or Claude Code missing, the chat shows a message naming what to install instead of a generic error.',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'PERF-02',
    area: 'performance',
    title: 'The bridge starts on first use and stops when idle',
    steps: [
      'Open Command Center and, before chatting, look at Activity Monitor for a node process under Command Center.',
      'Send a chat; look again.',
      'Set Settings > System > "Stop the AI helper when idle" to 5 min, wait 5 minutes without using it, look again; then send another chat.',
    ],
    expected:
      'No node process until the first chat; one during and after it; gone after 5 idle minutes (the status reads "Bridge on standby", not an error); the next chat starts it again and works. Choosing Never while it runs keeps it running.',
    needs: 'mac-desktop',
    setup: 'open-settings-system',
    rev: 1,
  },
  {
    id: 'PERF-03',
    area: 'performance',
    title: 'Battery and Low Power Mode lower the tier',
    steps: [
      'On a MacBook on AC power, open Settings > Performance with the tier at Balanced or higher.',
      'Unplug; wait up to a minute.',
      'Turn on Low Power Mode (System Settings > Battery); wait up to a minute; then turn off "Lighter on battery".',
    ],
    expected:
      'On AC the chosen tier applies; on battery the summary says it runs at Light (underlined on the scale); in Low Power Mode at Lightest (lock the app: the ASCII backdrop is a still frame); with "Lighter on battery" off the chosen tier applies again.',
    needs: 'mac-desktop',
    setup: 'tier-balanced',
    rev: 1,
  },
  {
    id: 'PERF-04',
    area: 'performance',
    title: 'Animations stop when the window is covered or minimized',
    steps: [
      'Lock the app so the ASCII backdrop animates, and open Activity Monitor > CPU.',
      'Minimize Command Center, then cover it fully with another window.',
    ],
    expected:
      'CPU for Command Center and its WebContent process drops to near zero while minimized or covered and the animation resumes when it is visible again.',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'MODEL-01',
    area: 'models',
    title: 'Hugging Face token and a cloud model',
    steps: [
      'Create a fine-grained token with "Make calls to Inference Providers" at huggingface.co/settings/tokens.',
      'Settings > AI agents > Hugging Face: paste it and Save key (never paste it into a chat).',
      'Model Lab > Add a model > Paste a link: openai/gpt-oss-20b:fastest, choose Hugging Face cloud, Add.',
      'Click the chat icon on the new model and send "Say hi in five words".',
    ],
    expected:
      'Keychain Access lists the token under "command-center"; the reply streams in; the Usage view counts its tokens and shows the cost as a dash, not a price.',
    needs: 'network',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'MODEL-02',
    area: 'models',
    title: 'Search Hugging Face and add a GGUF model for this Mac',
    steps: [
      'Model Lab > Add a model, type "qwen 0.5b" with the GGUF filter.',
      'Pick Qwen/Qwen2.5-0.5B-Instruct-GGUF; leave On this Mac, Ollama and Q4_K_M.',
      'Read the command shown, press Copy command and paste it into a text editor.',
    ],
    expected:
      'Results show downloads, likes and a Gated badge where it applies; the details show the license; the pasted command is exactly the one shown (ollama run hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M).',
    needs: 'network',
    setup: 'open-model-lab',
    rev: 1,
  },
  {
    id: 'MODEL-03',
    area: 'models',
    title: 'Run in Terminal starts the model with your runtime',
    steps: [
      'With Ollama installed, in the add dialog (or on a saved local model) press Run in Terminal.',
      'Allow Command Center to control Terminal if macOS asks.',
      'Wait for the download to finish, then press Check runtimes in the Model Lab.',
    ],
    expected:
      'A Terminal window opens running the command; the model card says Running; Settings > AI agents > On this computer lists Ollama as Running with the model counted.',
    needs: 'mac-desktop',
    setup: 'open-model-lab',
    rev: 1,
  },
  {
    id: 'MODEL-04',
    area: 'models',
    title: 'A model too big for this Mac is flagged',
    steps: [
      'Add a model, search "llama 70b gguf" and pick a 70B GGUF repo.',
      'Choose its largest quant.',
    ],
    expected:
      'An amber warning says the file is larger than this computer can comfortably run, before anything is saved or downloaded.',
    needs: 'mac-desktop',
    setup: 'open-model-lab',
    rev: 1,
  },
  {
    id: 'MODEL-05',
    area: 'models',
    title: 'Add a model file you already have',
    steps: [
      'Add a model > From a file > Choose a .gguf file, and pick one on this Mac.',
      'Choose llama.cpp, press Run in Terminal, then Add model.',
      'Chat with it.',
    ],
    expected:
      'The file is used where it is (nothing is copied or uploaded); llama-server starts on port 8080; the chat replies.',
    needs: 'mac-desktop',
    setup: 'open-model-lab',
    rev: 1,
  },
  {
    id: 'MODEL-06',
    area: 'models',
    title: 'Side-by-side test and Save to conversation',
    steps: [
      'In the Model Lab tick two models, type a prompt and press Run (or Cmd+Enter).',
      'When both finish, press Save to conversation on one.',
    ],
    expected:
      'Both replies stream at once with first-text time, tokens per second and tokens (a dash when a server reports none); saving opens a normal chat holding the prompt and that reply, which can be continued.',
    needs: 'mac-desktop',
    setup: 'open-model-lab',
    rev: 1,
  },
  {
    id: 'MODEL-07',
    area: 'models',
    title: 'Remote model servers stay off unless you allow them',
    steps: [
      'Edit a local model and set its server address to http://192.168.1.50:11434/v1, then chat with it.',
      'Settings > AI agents > On this computer: switch on Allow remote model servers, and chat again.',
    ],
    expected:
      'The first chat is refused with a message about remote servers; after allowing them it tries that address.',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'MODEL-08',
    area: 'models',
    title: 'Presets per model and per chat',
    steps: [
      'Settings > AI agents > Model presets: Edit presets on a local model, press Precise, Save.',
      'Start a chat with that model, open Chat settings and set Temperature to 1.2 under Presets for this chat; click elsewhere.',
      'Send a message, then press "Use the model\u2019s presets" and send another.',
    ],
    expected:
      'The field placeholders show the model\u2019s own values; the first reply uses temperature 1.2, the second the model\u2019s 0.2 (visible in the runtime\u2019s request log, e.g. llama-server\u2019s terminal); other chats with the same model are unaffected.',
    needs: 'mac-desktop',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'PLAN-01',
    area: 'plans',
    title: 'Read the Short-Let Launch Plan in Command Center',
    steps: [
      'If the Short-Let Launch Plan is not listed (a new computer), Add a plan and pick its downloaded HTML file.',
      'Click Business plans (the briefcase) in the left rail.',
      'Scroll the plan and use whatever it has: change a number in a calculator, tick a checklist box, press a Copy button.',
      'Switch to another view and back, then quit and reopen Command Center.',
    ],
    expected:
      'Short-Let Launch Plan is first in the list and opens on its own; it looks like the artifact; the calculator updates; the plan is still there after reopening. Ticks are not kept (the sandbox has no storage), and Copy may select the text instead of copying it.',
    needs: 'mac-desktop',
    setup: 'open-business-plans',
    rev: 1,
  },
  {
    id: 'PLAN-02',
    area: 'plans',
    title: 'Add, rename, reorder and remove a plan',
    steps: [
      'Business plans > Add a plan, pick any .html file.',
      'Rename it, press Move to the top, then remove it.',
    ],
    expected:
      'The new plan opens straight away; renaming and moving show at once; removing asks first and the Short-Let Launch Plan is first again.',
    needs: 'mac-desktop',
    setup: 'open-business-plans',
    rev: 1,
  },
  {
    id: 'PLAN-03',
    area: 'plans',
    title: 'Read a plan full width',
    steps: [
      'Open Business plans and press the panel button left of the plan title to hide the list; quit and reopen the app.',
      'Press Read full width (the expand arrows), then press it again.',
      'Press Read full width, then open another view from the rail and come back.',
    ],
    expected:
      'The list stays hidden after reopening until you show it again. Full width gives the plan the whole window (no list, explorer or assistant) and its pages reflow to the wider layout; pressing it again, or leaving the view, puts back exactly what was open before.',
    needs: 'mac-desktop',
    setup: 'open-business-plans',
    rev: 1,
  },
  {
    id: 'SHELL-03',
    area: 'shell',
    title: 'Delete a chat from the Explorer',
    steps: [
      'In the editor layout, hover a chat in the Explorer and press the bin icon; press Cancel.',
      'Press the bin again and Delete. Then press Tab to a chat row and Tab once more to its bin, and press Enter.',
    ],
    expected:
      'Cancel keeps the chat; Delete removes it and its messages; the bin shows when the row is hovered or has keyboard focus, and after deleting, focus is in the Explorer filter box. In both themes the bin turns red on hover and the open chat row keeps its highlight.',
    needs: 'mac-desktop',
    rev: 1,
  },
  {
    id: 'MODEL-09',
    area: 'models',
    title: "Delete a model's chats",
    steps: [
      'Have two chats with a Model Lab model and one with Claude.',
      "In the Model Lab, press the crossed-out speech bubble on that model's card; read the count, then press Delete chats.",
      'Press it again.',
    ],
    expected:
      'The confirmation says "Delete 2 chats with <model>?"; afterwards only the Claude chat is left in the Explorer, the model is still in the Model Lab, and pressing again says there are no chats with it yet.',
    needs: 'mac-desktop',
    setup: 'open-model-lab',
    rev: 1,
  },
  {
    id: 'MAC-10',
    area: 'macos',
    title: 'The app icon is the orange cross',
    steps: [
      'Open Command Center and look at its Dock icon, then press Cmd+Tab.',
      'Open Finder > Applications and find Command Center.',
    ],
    expected:
      'The Dock, the app switcher and Finder show the orange rounded square with the black cross of five joined squares, the same size and shape as other Mac app icons, crisp at small sizes. The menu bar icon is unchanged.',
    needs: 'mac-desktop',
    rev: 1,
  },
];
