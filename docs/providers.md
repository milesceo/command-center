# AI providers

How Command Center talks to each provider, what was researched, what is implemented and where the limits
are. Researched 2026-10-15 from the providers' own documentation (Hugging Face and local runtimes 2026-10-17). Re-check before relying on
anything marked **unverified**; both vendors' CLIs are changing quickly.

## The rule

Subscription sign-in goes through each provider's **official, documented route only**: their own
CLI or SDK. Command Center never scrapes a web session, reuses browser cookies, or reads or copies OAuth
tokens that another app wrote. API keys are kept in the OS credential store (Windows Credential
Manager, via the `keyring` crate) and are passed to the bridge for one request at a time; they are
never written to SQLite, config files or logs.

Mechanically:

- `packages/bridge/src/providers/types.ts` defines the `Provider` interface (id, display name,
  auth methods, models, `authStatus`, streaming `chat` with a cancellable handle, optional `login`
  and `usage`, and `run` for the local provider's `local.run`).
- `registry.ts` lists the adapters; the bridge routes `ChatRequest.provider` to one.
- A provider's `login` only **opens the provider's own sign-in in a terminal window** (for example
  `codex login`); the user completes it there. Command Center polls `authStatus` while the card is open.

## Claude (Anthropic)

|             |                                                                                              |
| ----------- | -------------------------------------------------------------------------------------------- |
| Route       | Claude Agent SDK on the user's Claude Code login (their Claude subscription)                 |
| Auth status | `claude auth status` (JSON: `loggedIn`, `authMethod`, `subscriptionType`)                    |
| Sign-in     | `claude auth login` in a terminal (the CLI may ask for a pasted code)                        |
| API key     | **Not supported on purpose.** `ANTHROPIC_API_KEY` is stripped from the runtime's environment |
| Usage       | Plan windows and per-model tokens from the SDK (unchanged from before the abstraction)       |

Behavior is unchanged: the original chat path was moved behind the interface (`providers/claude.ts`)
without altering what it does, and all the existing bridge tests still pass.

Claude is detected automatically: when `claude auth status` reports a login, the card shows
"Connected" and the provider is enabled with no further steps.

## ChatGPT (OpenAI)

**Official route: the Codex CLI with "Sign in with ChatGPT".** OpenAI documents two sign-in methods
for Codex: signing in with a ChatGPT account (subscription access) or an API key (usage-based
billing), and `codex login` is the CLI command for the first. The CLI caches the login and
refreshes it itself. OpenAI also publishes a TypeScript SDK (`@openai/codex-sdk`) that drives the
local Codex runtime and, per OpenAI's CI guidance, recommends API keys for automation.

What I could **not** find: any OpenAI page that grants or forbids third-party apps reusing a
ChatGPT subscription login beyond the Codex clients themselves. The docs navigation lists a
separate "Sign in with ChatGPT" section for apps powered by the user's ChatGPT plan, but its terms
were not readable from the pages fetched. So Command Center does the conservative thing: it **runs the
user's own installed `codex` CLI** and never touches its credentials.

|             |                                                                                                                              |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Implemented | `providers/codex.ts`: `codex exec --json --skip-git-repo-check --sandbox read-only [--model m] -`, prompt over stdin         |
| Auth status | `codex login status` (exit 0 = signed in)                                                                                    |
| Sign-in     | `codex login` in a terminal                                                                                                  |
| Events used | `item.completed` with an `agent_message` (older builds: `assistant_message`), `turn.completed` usage, `turn.failed`, `error` |
| API key     | None. OpenAI's own docs route API-key users to the OpenAI API, which this adapter does not use                               |
| Models      | "Codex default" only; a model id may be set per chat and is validated against `^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$`          |

Limits:

- Requires the CLI to be installed (`npm i -g @openai/codex`). If it is not found the card says so.
- Codex is a coding **agent**; replies arrive as whole messages, not token by token, and tools are
  held off (`read-only` sandbox, no approvals).
- Usage reporting is token counts only; no plan-window information.
- **Unverified here:** the exact JSONL schema across Codex versions (the parser accepts both item
  type spellings and ignores unknown events), and behavior on a real ChatGPT login (it was
  exercised against a scripted stand-in, not an account).

Sources: OpenAI Codex authentication docs (`developers.openai.com/codex/auth`), non-interactive
mode docs, and the Codex SDK page (`developers.openai.com/codex/sdk`, which redirect to
`learn.chatgpt.com/docs/...`).

## Grok (xAI)

xAI offers **two** official routes, so both are implemented and the API key is preferred.

1. **API key**: the documented xAI API (`https://api.x.ai/v1`, OpenAI-compatible chat completions
   with server-sent-event streaming and `stream_options.include_usage`). The xAI quick start shows
   Bearer-token auth with an API key; the console is `console.x.ai`. API usage is billed
   separately from consumer subscriptions. _Unverified:_ the docs page I could fetch demonstrated
   the Responses endpoint; chat completions is used because xAI describes the API as
   OpenAI-compatible, and an unexpected status is mapped to a clear error rather than guessed at.
2. **Grok CLI** (Grok Build): xAI documents `grok login` (with `--device-auth`) and says Grok
   Build is available to SuperGrok and X Premium+ subscribers (early beta). Headless use is
   `grok -p "<prompt>" --output-format plain|json|streaming-json`, `-m <model>`,
   `--no-auto-update`, `--cwd`. The documented page does **not** specify the JSON event schema,
   exit codes, or whether a subscription login is meant for headless/third-party use, so Command Center
   uses `plain` output only and treats this route as **beta**.

|              |                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------- |
| Implemented  | `providers/grok.ts`: API route (SSE parser, HTTP status mapping) and CLI route (`grok -p`)            |
| Route choice | An API key, when stored, wins; otherwise the CLI if found; otherwise a clear error                    |
| Auth status  | Key present → signed in via API key. CLI only → `unknown` (xAI documents no way to query login state) |
| Sign-in      | `grok login` in a terminal                                                                            |
| Models       | Default, `grok-4.7` (named in xAI's docs); others may be typed per chat                               |

Limits (shown in the UI): the CLI route returns plain text with no token counts; a prompt over about
24,000 characters is refused on that route because the prompt is a command-line argument (the API
route has no such limit); `.cmd` shims are refused for the CLI route because a prompt cannot be
passed through a shell safely.

Sources: xAI developer docs (`docs.x.ai`: overview, Build CLI reference, headless scripting).

## Hugging Face (cloud)

Researched 2026-10-17 from Hugging Face's Inference Providers documentation and checked live where
noted.

- **Route:** the OpenAI-compatible router `POST https://router.huggingface.co/v1/chat/completions`
  with `Authorization: Bearer <token>` and SSE streaming (`stream: true`,
  `stream_options.include_usage`). The model is a Hub repo id; a suffix picks who serves it:
  `:fastest`, `:cheapest` or a provider name (`openai/gpt-oss-20b:groq`). Without one the router
  chooses.
- **Token:** a fine-grained user access token with "Make calls to Inference Providers"
  (huggingface.co/settings/tokens). It is an official route, so Command Center takes it as an API
  key: stored in the OS credential store under `api-key:huggingface`, read for one request at a
  time. Billing is the user's Hugging Face account (free accounts get a small monthly credit).
- **Errors:** 401/403 → token problem, 402 → billing, 404 → no provider serves the model, 429 →
  rate limited, 5xx → provider down. The mapping is shared with Grok (`openai-compat.ts`); the
  exact codes the router returns for each case are **unverified** (no token was used here).
- **Parameters:** temperature, top_p, max_tokens and up to 4 stop sequences are sent. top_k,
  repetition penalty and context length are not part of the router's OpenAI schema and are not sent.
- **The Hub API** (`GET /api/models?search=&filter=gguf|mlx&pipeline_tag=text-generation`,
  `/api/models/{id}`, `/api/models/{id}/tree/main`) is read anonymously from the webview to search
  and inspect models; it answers with CORS headers (checked live 2026-10-17). CSP `connect-src`
  allows `https://huggingface.co` for this. Every field is validated and shown only as text.

|             |                                                                        |
| ----------- | ---------------------------------------------------------------------- |
| Implemented | `providers/huggingface.ts`, `apps/desktop/src/lib/hf-hub.ts`           |
| Auth status | Key present → signed in via API key; otherwise not connected           |
| Models      | None built in; the user adds them in the Model Lab (`cm:<id>`)         |
| Cost        | Not reported by the router; the Usage view shows a dash, never a price |

## On this computer (local runtimes)

Command Center never downloads or runs model weights itself. It drives the runtime the user
installed through that runtime's own command and OpenAI-compatible server, and talks only to
loopback addresses unless Settings > AI agents > "Allow remote model servers" is on (checked by the
protocol parser and again by the adapter).

| Runtime   | Command it runs (shown before it runs)                                                            | Server               | Status                                                                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ollama    | `ollama run hf.co/<repo>[:<quant>]`; a file: a temporary Modelfile, `ollama create`, `ollama run` | `127.0.0.1:11434/v1` | **Verified 2026-10-18** with Ollama 0.40.4: pulled `Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M`, listed as `hf.co/…:Q4_K_M`, chat streamed with usage                                                              |
| llama.cpp | `llama-server -hf <repo>[:<quant>] --port 8080`; a file: `-m <path> --alias <name>`               | `127.0.0.1:8080/v1`  | **Verified 2026-10-18** with Homebrew llama-server: the file route served and chatted (top_k and repetition_penalty accepted). The default port is changing to 9931 upstream, so the port is passed explicitly |
| MLX-LM    | `mlx_lm.server --model <repo or folder> --port 8081 [--adapter-path <dir>]`                       | `127.0.0.1:8081/v1`  | **Unverified** (not installed here): flags from its README; `default_model` as the chat model for a folder is an assumption                                                                                    |
| LM Studio | `lms get <repo>` or `lms import <path>`, then `lms server start`                                  | `127.0.0.1:1234/v1`  | **Unverified** (not installed here); the model identifier LM Studio assigns is guessed and can be edited in the model's settings                                                                               |

- **Run in Terminal** (`local.run`) builds the line from validated parts only (repo ids, quant tags,
  absolute paths, the runtime's resolved path), POSIX-quotes every part (`shellQuote`, shared from
  `packages/protocol`, so the Model Lab shows the same line, with the bare program name where the
  bridge uses its full path) and opens Terminal or iTerm, which prints the line and runs it only
  when you press Enter there. Off macOS it returns the line to run by hand. The Ollama file route
  runs its script through `/bin/sh -c`, so it works in any login shell (fish included).
- **No redirects:** chat requests and status probes to local servers refuse HTTP redirects unless
  remote servers are allowed, so a loopback port cannot bounce a chat to another computer.
- **Status:** `GET <server>/models` with a 1 s timeout for each runtime, plus whether its command is
  installed.
- **Parameters:** temperature, top_p, top_k, max_tokens, stop and repetition_penalty are sent.
  Context length is stored but not sent per chat (runtimes set it when they start).
- **Memory:** the add dialog compares the chosen file's size with total memory (`system_memory`):
  over 75 % warns, over 50 % notes it. Model files picked from disk have no size check yet.

## Adding a provider

1. Add its id to `PROVIDER_IDS` in `packages/protocol/src/index.ts` (and bump `PROTOCOL_VERSION`
   only if the wire format changes).
2. Implement `Provider` in `packages/bridge/src/providers/<name>.ts`.
3. Register it in `providers/registry.ts`.
4. Add its card copy to `apps/desktop/src/lib/providers.ts`.
5. Add tests with a scripted fake process or fetch (see `providers.test.ts`).
6. Document the official sign-in route and its limits here **before** shipping it.
