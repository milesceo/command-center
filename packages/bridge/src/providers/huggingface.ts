import { isHfRepoId, type ChatRequest } from '@command-center/protocol';
import { paramsBody, streamCompatChat } from './openai-compat';
import type { ChatHandle, Provider, ProviderAuth, ProviderContext } from './types';

/**
 * Hugging Face Inference Providers: one OpenAI-compatible router in front of many inference
 * providers (researched 2026-10-17, see docs/providers.md). The model is any Hub repo id, with an
 * optional `:provider` or policy suffix (`:fastest`, the default, `:cheapest`, `:preferred`). The
 * user's access token (fine-grained, "Make calls to Inference Providers") lives in the OS
 * credential store and is attached by the app to one request at a time, like the xAI key.
 */

export const HF_CHAT_URL = 'https://router.huggingface.co/v1/chat/completions';

export const huggingfaceProvider: Provider = {
  id: 'huggingface',
  displayName: 'Hugging Face',
  authMethods: ['apiKey'],
  note: 'Runs open models in the cloud through Hugging Face Inference Providers, billed to your Hugging Face account. Add models from the Model Lab.',

  // The models are the user's own (Model Lab); there is no fixed list.
  models: () => [],

  authStatus(_ctx: ProviderContext, hasKey: boolean): Promise<ProviderAuth> {
    return Promise.resolve(
      hasKey ? { state: 'signed_in', via: 'apiKey' } : { state: 'signed_out' },
    );
  },

  chat(request: ChatRequest, ctx: ProviderContext): ChatHandle {
    const fail = (message: string, code: 'auth_required' | 'invalid_request') => {
      ctx.emit({ type: 'error', id: request.id, error: { code, message } });
      return { done: Promise.resolve(), cancel: () => undefined };
    };
    if (!request.apiKey) {
      return fail('Add a Hugging Face access token in Settings > AI agents.', 'auth_required');
    }
    if (!isHfRepoId(request.model)) {
      return fail('Choose a Hugging Face model (owner/name) in the Model Lab.', 'invalid_request');
    }
    return streamCompatChat(request, ctx, {
      service: 'Hugging Face',
      credential: 'token',
      url: HF_CHAT_URL,
      headers: { authorization: `Bearer ${request.apiKey}` },
      model: request.model,
      // The router documents temperature, top_p, max_tokens and up to 4 stop sequences; top_k,
      // repetition penalty and context length are not part of its API, so they are not sent.
      extra: paramsBody(request.params, { maxStop: 4 }),
    });
  },
};
