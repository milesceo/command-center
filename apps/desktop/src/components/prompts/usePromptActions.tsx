import { useState, type ReactNode } from 'react';
import { extractVariables, renderPrompt } from '../../lib/prompt-vars';
import type { Prompt } from '../../lib/types';
import { conversationsStore, selectActiveSettings } from '../../stores/conversations';
import { VariablesForm } from './VariablesForm';

interface Pending {
  prompt: Prompt;
  initial: Record<string, string>;
  confirmLabel: string;
  done: (values: Record<string, string>) => void;
}

/**
 * Shared flow for using a prompt: without variables it applies at once; with
 * variables a small form collects them first. Render `dialog` somewhere in the tree.
 */
export function usePromptActions(): {
  /** Produces the prompt text (variables filled in) and passes it to `onText`. */
  requestText: (prompt: Prompt, onText: (text: string) => void) => void;
  /** Attaches a library system prompt to the open conversation (or the new-chat draft). */
  attachSystemPrompt: (prompt: Prompt) => void;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<Pending | null>(null);

  const ask = (
    prompt: Prompt,
    confirmLabel: string,
    done: (values: Record<string, string>) => void,
    initial: Record<string, string> = {},
  ) => {
    if (extractVariables(prompt.body).length === 0) done({});
    else setPending({ prompt, initial, confirmLabel, done });
  };

  return {
    requestText: (prompt, onText) =>
      ask(prompt, 'Insert', (values) => onText(renderPrompt(prompt.body, values))),
    attachSystemPrompt: (prompt) => {
      const current = selectActiveSettings(conversationsStore.getState());
      ask(
        prompt,
        'Use as system prompt',
        (values) =>
          void conversationsStore.getState().updateSettings({
            systemPromptId: prompt.id,
            systemPromptVars: values,
            systemPrompt: null,
          }),
        current.systemPromptId === prompt.id ? current.systemPromptVars : {},
      );
    },
    dialog: pending && (
      <VariablesForm
        title={pending.prompt.title}
        body={pending.prompt.body}
        variables={extractVariables(pending.prompt.body)}
        initial={pending.initial}
        confirmLabel={pending.confirmLabel}
        onCancel={() => setPending(null)}
        onSubmit={(values) => {
          const { done } = pending;
          setPending(null);
          done(values);
        }}
      />
    ),
  };
}
