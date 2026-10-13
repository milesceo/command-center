import { createContext, useContext } from 'react';

export interface MarkdownContextValue {
  /** Id of the message being rendered; with the block position it identifies a code block across streaming and storage. */
  messageId: string;
  /** True while the reply is still arriving. */
  streaming: boolean;
}

export const MarkdownContext = createContext<MarkdownContextValue>({
  messageId: 'detached',
  streaming: false,
});
export const useMarkdownContext = () => useContext(MarkdownContext);
