import { useMemo } from 'react';
import { extractCodeBlocks, type ConversationBlock } from '../../lib/code-blocks';
import type { Message } from '../../lib/types';
import { useChat } from '../../stores/chat';

const cache = new WeakMap<Message, ConversationBlock[]>();

function blocksOf(message: Message): ConversationBlock[] {
  let blocks = cache.get(message);
  if (!blocks) {
    blocks = extractCodeBlocks(message.content).map((b) => ({ ...b, messageId: message.id }));
    cache.set(message, blocks);
  }
  return blocks;
}

/** Every code block in the open conversation's stored assistant replies, in order. */
export function useConversationBlocks(): ConversationBlock[] {
  const messages = useChat((s) => s.messages);
  return useMemo(
    () => messages.filter((m) => m.role === 'assistant').flatMap(blocksOf),
    [messages],
  );
}
