import { describe, expect, it } from 'vitest';
import {
  MESSAGES,
  greetingFor,
  pickMessage,
  renderTemplate,
  type MessageContext,
} from './launch-messages';

const ctx = (over: Partial<MessageContext> = {}): MessageContext => ({
  name: 'Elijah',
  now: new Date(2026, 9, 14, 9, 30), // a Wednesday morning
  stats: { chatsYesterday: 3, chatsToday: 1, chatsTotal: 42, messagesTotal: 120 },
  ...over,
});

/** A deterministic generator that walks through [0, 1) so every entry gets a turn. */
const sweep = (n: number) => {
  let i = 0;
  return () => (i++ % n) / n;
};

describe('the message data', () => {
  it('has at least 40 entries with unique ids and positive weights', () => {
    expect(MESSAGES.length).toBeGreaterThanOrEqual(40);
    expect(new Set(MESSAGES.map((m) => m.id)).size).toBe(MESSAGES.length);
    expect(MESSAGES.every((m) => m.weight > 0)).toBe(true);
  });

  it('mixes greetings, quips and stats', () => {
    const kinds = new Set(MESSAGES.map((m) => m.kind));
    expect(kinds).toEqual(new Set(['greeting', 'quip', 'stat']));
  });

  it('only uses placeholders the renderer knows', () => {
    for (const m of MESSAGES) {
      const text = renderTemplate(m.text, ctx());
      expect(text, m.id).not.toBeNull();
      expect(text, m.id).not.toMatch(/[{}]/);
    }
  });
});

describe('greetingFor', () => {
  it('follows the time of day', () => {
    expect(greetingFor(9)).toBe('Good morning');
    expect(greetingFor(13)).toBe('Good afternoon');
    expect(greetingFor(19)).toBe('Good evening');
    expect(greetingFor(2)).toBe('Burning the midnight oil');
  });
});

describe('renderTemplate', () => {
  it('fills the name, greeting and weekday', () => {
    expect(renderTemplate('{greeting}, {name}.', ctx())).toBe('Good morning, Elijah.');
    expect(renderTemplate('Happy {day}.', ctx())).toBe('Happy Wednesday.');
  });

  it('pluralizes stats and skips what is missing', () => {
    expect(renderTemplate('{chatsYesterday} yesterday', ctx())).toBe('3 chats yesterday');
    const one = ctx({ stats: { chatsYesterday: 1 } });
    expect(renderTemplate('{chatsYesterday} yesterday', one)).toBe('1 chat yesterday');
    expect(renderTemplate('{chatsYesterday} yesterday', ctx({ stats: {} }))).toBeNull();
    expect(renderTemplate('Hi {name}', ctx({ name: '  ' }))).toBeNull();
  });
});

describe('pickMessage', () => {
  it('never repeats the previous launch', () => {
    const rng = sweep(500);
    for (let i = 0; i < 500; i++) {
      const picked = pickMessage(ctx(), { lastId: 'hello-time', rng });
      expect(picked.id).not.toBe('hello-time');
    }
  });

  it('uses only entries it can fill', () => {
    const noName = ctx({ name: '', stats: {} });
    const rng = sweep(500);
    for (let i = 0; i < 500; i++) {
      const picked = pickMessage(noName, { rng });
      expect(picked.text).not.toMatch(/\{|undefined/);
      expect(picked.kind).not.toBe('stat');
    }
  });

  it('respects the weights', () => {
    const messages = [
      { id: 'heavy', kind: 'quip' as const, weight: 9, text: 'a' },
      { id: 'light', kind: 'quip' as const, weight: 1, text: 'b' },
    ];
    const rng = sweep(1000);
    const counts = { heavy: 0, light: 0 };
    for (let i = 0; i < 1000; i++) {
      const id = pickMessage(ctx(), { messages, rng }).id as 'heavy' | 'light';
      counts[id] += 1;
    }
    expect(counts.heavy).toBe(900);
    expect(counts.light).toBe(100);
  });

  it('falls back when nothing is eligible and allows a repeat when there is no choice', () => {
    expect(pickMessage(ctx(), { messages: [] }).id).toBe('fallback');
    const only = [{ id: 'solo', kind: 'quip' as const, weight: 1, text: 'x' }];
    expect(pickMessage(ctx(), { messages: only, lastId: 'solo' }).id).toBe('solo');
  });
});
