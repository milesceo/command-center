import { renderPrompt } from './prompt-vars';
import type { ConversationSettings, Project, Prompt } from './types';

export type SystemPromptSource = 'conversation' | 'library' | 'project' | 'none';

export interface ResolvedSystemPrompt {
  text: string | null;
  source: SystemPromptSource;
  /** Title of the library prompt in effect, when there is one. */
  title: string | null;
}

/**
 * Which system prompt a conversation actually uses, most specific first:
 * 1. text written for this conversation,
 * 2. a library system prompt attached to it,
 * 3. the default system prompt of its project.
 * Library prompts are rendered with their stored variable values at send time, so
 * editing the library prompt updates every conversation that references it.
 */
export function resolveSystemPrompt(
  settings: Pick<ConversationSettings, 'systemPrompt' | 'systemPromptId' | 'systemPromptVars'>,
  project: Pick<Project, 'defaultSystemPromptId' | 'defaultSystemPromptVars'> | null,
  prompts: Pick<Prompt, 'id' | 'kind' | 'title' | 'body'>[],
): ResolvedSystemPrompt {
  const custom = settings.systemPrompt?.trim();
  if (custom) return { text: custom, source: 'conversation', title: null };

  const find = (id: string | null) =>
    id ? prompts.find((p) => p.id === id && p.kind === 'system') : undefined;

  const attached = find(settings.systemPromptId);
  if (attached) {
    return {
      text: renderPrompt(attached.body, settings.systemPromptVars).trim() || null,
      source: 'library',
      title: attached.title,
    };
  }
  const inherited = project ? find(project.defaultSystemPromptId) : undefined;
  if (inherited && project) {
    return {
      text: renderPrompt(inherited.body, project.defaultSystemPromptVars).trim() || null,
      source: 'project',
      title: inherited.title,
    };
  }
  return { text: null, source: 'none', title: null };
}
