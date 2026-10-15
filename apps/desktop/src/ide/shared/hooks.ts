import { useMemo } from 'react';
import { useConversationBlocks } from '../../components/code/useConversationBlocks';
import { useChat } from '../../stores/chat';
import { useConversations } from '../../stores/conversations';
import { useProjects } from '../../stores/projects';
import { deriveFiles, type FileEntry } from './files';
import { buildTurns, groupThreads, type ThreadGroup, type Turn } from './threads';

/** Files (with versions) Claude wrote in the open conversation's stored replies. */
export function useActiveFiles(): FileEntry[] {
  const blocks = useConversationBlocks();
  return useMemo(() => deriveFiles(blocks), [blocks]);
}

/** Prompt/reply pairs of the open conversation. */
export function useTurns(): Turn[] {
  const messages = useChat((s) => s.messages);
  return useMemo(() => buildTurns(messages), [messages]);
}

/** All conversations grouped by project. */
export function useThreadGroups(): ThreadGroup[] {
  const conversations = useConversations((s) => s.conversations);
  const projects = useProjects((s) => s.projects);
  return useMemo(() => groupThreads(conversations, projects), [conversations, projects]);
}

/**
 * Key of the file written by the newest reply (by position in the transcript), or null.
 * Editors use it to follow the conversation as replies change files.
 */
export function useNewestFileKey(files: readonly FileEntry[]): string | null {
  const messages = useChat((s) => s.messages);
  return useMemo(() => {
    const position = new Map(messages.map((m, i) => [m.id, i]));
    let best: { key: string; at: number } | null = null;
    for (const f of files) {
      const at = position.get(f.versions[f.versions.length - 1]?.messageId ?? '') ?? -1;
      if (!best || at >= best.at) best = { key: f.key, at };
    }
    return best?.key ?? null;
  }, [files, messages]);
}
