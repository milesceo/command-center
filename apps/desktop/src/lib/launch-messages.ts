/**
 * The rotating line under the logo on the landing screen. All copy lives in `MESSAGES`: add or
 * edit an entry there and nothing else changes.
 *
 * A template may use placeholders; an entry is only eligible when every placeholder in it can
 * be filled (no name set, or no chats yesterday, means that entry is skipped).
 *   {name}      the user's name
 *   {greeting}  "Good morning" / "Good afternoon" / "Good evening" / "Burning the midnight oil"
 *   {day}       the weekday name
 *   {chatsYesterday} {chatsToday} {chatsTotal} {messagesTotal}   e.g. "3 chats" (omitted at 0)
 */

export type MessageKind = 'greeting' | 'quip' | 'stat';

export interface MessageTemplate {
  id: string;
  kind: MessageKind;
  /** Relative chance of being picked; 1 is normal. */
  weight: number;
  text: string;
}

export interface LaunchStats {
  chatsYesterday?: number;
  chatsToday?: number;
  chatsTotal?: number;
  messagesTotal?: number;
}

export interface MessageContext {
  name: string;
  now: Date;
  stats: LaunchStats;
}

const g = (id: string, text: string, weight = 1): MessageTemplate => ({
  id,
  kind: 'greeting',
  weight,
  text,
});
const q = (id: string, text: string, weight = 1): MessageTemplate => ({
  id,
  kind: 'quip',
  weight,
  text,
});
const s = (id: string, text: string, weight = 1): MessageTemplate => ({
  id,
  kind: 'stat',
  weight,
  text,
});

export const MESSAGES: readonly MessageTemplate[] = [
  // Personalized greetings
  g('hello-time', '{greeting}, {name}.', 3),
  g('welcome-back', 'Welcome back, {name}.', 2),
  g('ready-when', 'Ready when you are, {name}.', 2),
  g('what-today', 'What are we building today, {name}?', 2),
  g('happy-day', 'Happy {day}, {name}.'),
  g('good-to-see', 'Good to see you, {name}.'),
  g('cursor-blinking', '{name}, the cursor is blinking. Your move.'),
  g('lets-ship', "Let's ship something, {name}."),
  g('hello-plain', '{greeting}.', 2),
  g('day-plain', 'Happy {day}.'),

  // Coding quips and jokes (no name needed)
  q('it-works', "It works on my machine. Let's keep it that way."),
  q(
    'off-by-one',
    'There are two hard problems: naming, cache invalidation, and off-by-one errors.',
  ),
  q('semicolon', 'A missing semicolon has ended better careers than any manager.'),
  q('git-blame', 'git blame says it was you. It usually is.'),
  q('tabs-spaces', 'Tabs versus spaces: the only war where everyone is wrong in a different way.'),
  q('works-tests', 'The tests pass. Suspicious, but welcome.'),
  q('regex', 'You had a problem. You used a regex. Now you have two.'),
  q('todo', 'TODO: finish this. (Written in 2019.)'),
  q('cache', "It's always the cache. Or DNS. Or the cache's DNS."),
  q('rubber-duck', 'Rubber duck debugging, but the duck answers back.'),
  q('console-log', 'console.log("here") is a legitimate debugging strategy.'),
  q('friday', 'Never deploy on a Friday. Prompt about it instead.'),
  q('one-more', "One more small change. That's what you said an hour ago."),
  q('null', 'null is not a billion-dollar mistake if you check for it.'),
  q('naming', 'Naming things is hard. Renaming them is harder.'),
  q('ten-min', 'Ten minutes of prompting can save ten minutes of reading the docs.'),
  q('merge', 'Merge conflicts are just git asking for a second opinion.'),
  q('rm-rf', "Measure twice, rm -rf once. Or don't."),
  q('stack', "Stack Overflow can't see your codebase. Geeked can."),
  q('refactor', 'Refactoring: moving the bugs somewhere cleaner.'),
  q('coffee', 'Insert coffee to continue.'),
  q('prod', 'Everything is fine in production. Probably.'),
  q('bits', 'There are 10 kinds of people: those who get binary jokes and those who ask why.'),
  q('async', 'Await is just a polite way to say "later".'),
  q('docs', 'Documentation is love letters to your future self.'),
  q('hotfix', 'Every hotfix is a feature you did not plan for.'),
  q('type', 'Types are comments the compiler actually reads.'),
  q('bug-feature', "It's not a bug. It's an undocumented feature."),
  q('clean', 'Clean code is code you can read at 2 a.m.'),
  q('geeked', 'Geeked: because "prompting about code" is a mouthful.'),

  // Stats (only when there is something to report)
  s('stat-yesterday', '{chatsYesterday} yesterday. Keeping the streak?'),
  s('stat-yesterday-2', '{chatsYesterday} yesterday, {name}. Nice pace.', 2),
  s('stat-today', '{chatsToday} so far today.'),
  s('stat-total', '{chatsTotal} saved on this machine. All of them local.'),
  s('stat-messages', '{messagesTotal} messages exchanged. Not counting the thinking.'),
  s('stat-total-name', "{name}, that's {chatsTotal} and counting."),
];

export const DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Greeting for the hour of day (0-23). */
export function greetingFor(hour: number): string {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 22) return 'Good evening';
  return 'Burning the midnight oil';
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const FILLERS: Record<string, (ctx: MessageContext) => string | null> = {
  name: (c) => (c.name.trim() === '' ? null : c.name.trim()),
  greeting: (c) => greetingFor(c.now.getHours()),
  day: (c) => DAYS[c.now.getDay()] ?? null,
  chatsYesterday: (c) =>
    c.stats.chatsYesterday ? plural(c.stats.chatsYesterday, 'chat', 'chats') : null,
  chatsToday: (c) => (c.stats.chatsToday ? plural(c.stats.chatsToday, 'chat', 'chats') : null),
  chatsTotal: (c) => (c.stats.chatsTotal ? plural(c.stats.chatsTotal, 'chat', 'chats') : null),
  messagesTotal: (c) =>
    c.stats.messagesTotal ? plural(c.stats.messagesTotal, 'message', 'messages') : null,
};

/** Fills a template, or returns null when a placeholder has no value. */
export function renderTemplate(text: string, ctx: MessageContext): string | null {
  let missing = false;
  const out = text.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = FILLERS[key]?.(ctx) ?? null;
    if (value === null) missing = true;
    return value ?? '';
  });
  return missing ? null : out;
}

export interface PickedMessage {
  id: string;
  kind: MessageKind;
  text: string;
}

/**
 * Weighted random choice among the entries that can be filled, never the one shown on the
 * previous launch (unless it is the only possibility). `rng` returns [0, 1).
 */
export function pickMessage(
  ctx: MessageContext,
  options: {
    lastId?: string | null;
    rng?: () => number;
    messages?: readonly MessageTemplate[];
  } = {},
): PickedMessage {
  const { lastId = null, rng = Math.random, messages = MESSAGES } = options;
  const eligible: Array<PickedMessage & { weight: number }> = [];
  for (const m of messages) {
    const text = renderTemplate(m.text, ctx);
    if (text !== null && m.weight > 0) {
      eligible.push({ id: m.id, kind: m.kind, text, weight: m.weight });
    }
  }
  if (eligible.length === 0) return { id: 'fallback', kind: 'quip', text: 'Welcome to Geeked.' };
  const pool = eligible.length > 1 ? eligible.filter((m) => m.id !== lastId) : eligible;
  const total = pool.reduce((sum, m) => sum + m.weight, 0);
  let roll = Math.min(Math.max(rng(), 0), 0.999999999) * total;
  for (const m of pool) {
    roll -= m.weight;
    if (roll < 0) return { id: m.id, kind: m.kind, text: m.text };
  }
  const last = pool[pool.length - 1]!;
  return { id: last.id, kind: last.kind, text: last.text };
}

const LAST_KEY = 'geeked-last-message';

/** Picks for this launch and remembers it, so the next launch shows something different. */
export function pickForLaunch(ctx: MessageContext): PickedMessage {
  let lastId: string | null = null;
  try {
    lastId = window.localStorage.getItem(LAST_KEY);
  } catch {
    // Storage blocked: repeats are possible, nothing breaks.
  }
  const picked = pickMessage(ctx, { lastId });
  try {
    window.localStorage.setItem(LAST_KEY, picked.id);
  } catch {
    // See above.
  }
  return picked;
}
