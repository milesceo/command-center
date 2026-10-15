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
};

/** What a scenario button in the panel can do for you (see `scenarios.ts`). */
export const SCENARIO_IDS = [
  'go-home',
  'restart-onboarding',
  'open-settings-security',
  'open-settings-agents',
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
export type QaNeeds = 'any' | 'windows-desktop' | 'real-login' | 'network';

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
      'Quit Geeked completely (tray: Quit, or close the window).',
      'Start it again from the shortcut.',
      'Watch the first second.',
    ],
    expected:
      'The spinning GEEKED logo is on screen almost immediately (no blank white or black flash), stays about a second, then fades into the PIN lock (or Home with no PIN) with no layout jump.',
    needs: 'windows-desktop',
    setup: 'reload-app',
    rev: 1,
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
      'Note the top-left logo and the line under the Geeked mark.',
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
      'Start Geeked and enter the old PIN.',
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
      'Find the Geeked icon in the system tray.',
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
      'Open Geeked again from the tray icon.',
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
      'Turn on "Launch Geeked when Windows starts".',
      'Open Task Manager > Startup apps and look for Geeked.',
      'Sign out and back in (or restart).',
      'Turn the setting off again and check Task Manager.',
    ],
    expected:
      'Geeked appears in Startup apps when on and starts after signing in; it is gone from the list when off.',
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
    expected: 'Geeked switches theme without a restart.',
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
      'Open Windows Credential Manager > Windows Credentials and look for a "geeked" entry.',
      'Start a chat with Grok.',
      'Remove the key in Geeked and check Credential Manager again.',
    ],
    expected:
      'An entry named api-key:xai under the geeked service appears and is gone after Remove; the chat answers; the key never shows in any file or in the database.',
    needs: 'real-login',
    setup: 'open-settings-agents',
    rev: 1,
  },
  {
    id: 'PROV-03',
    area: 'providers',
    title: 'ChatGPT sign-in through the Codex CLI',
    steps: [
      'Install the Codex CLI (npm i -g @openai/codex) if needed.',
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
      'Turn off your network (airplane mode) and start Geeked.',
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
];
