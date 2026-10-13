import type { Attachment, ChatMessage } from '@programish/protocol';

/** Above this many characters the oldest turns are dropped to stay inside the context window. */
export const MAX_PROMPT_CHARS = 400_000;

function renderAttachments(attachments: Attachment[] | undefined): string {
  if (!attachments?.length) return '';
  return attachments
    .map((a) => `<attachment name=${JSON.stringify(a.name)}>\n${a.text}\n</attachment>`)
    .join('\n\n');
}

function renderMessage(message: ChatMessage): string {
  const attachments = renderAttachments(message.attachments);
  return attachments ? `${attachments}\n\n${message.content}` : message.content;
}

/**
 * Each turn is a fresh, non-persisted query, so prior turns are replayed as a
 * transcript inside the prompt. The app (SQLite) is the source of truth, which
 * is what makes edit, regenerate, model switches and stopped replies trivial:
 * there is no hidden server-side session to fork or repair.
 */
export function buildPrompt(messages: ChatMessage[], maxChars = MAX_PROMPT_CHARS): string {
  const latest = messages[messages.length - 1];
  if (!latest) return '';
  const latestText = renderMessage(latest);
  if (messages.length === 1) return latestText;

  const history = messages.slice(0, -1).map((m) => `[${m.role}]\n${renderMessage(m)}`);

  // Drop oldest turns first; the latest message is always kept.
  let budget = maxChars - latestText.length;
  const kept: string[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i] as string;
    if (entry.length > budget) break;
    budget -= entry.length;
    kept.unshift(entry);
  }
  const omitted = history.length - kept.length;
  const note = omitted > 0 ? `[${omitted} earlier message(s) omitted for length]\n\n` : '';

  if (kept.length === 0) return `${note}${latestText}`;
  return [
    'Below is the conversation so far, followed by the latest user message.',
    'Reply to the latest user message only, continuing the conversation naturally.',
    '',
    '<transcript>',
    `${note}${kept.join('\n\n')}`,
    '</transcript>',
    '',
    '[user]',
    latestText,
  ].join('\n');
}
