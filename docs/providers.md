# AI providers

How Command Center talks to each provider, what was researched, what is implemented and where the limits
are. Researched 2026-10-15 from the providers' own documentation. Re-check before relying on
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
  and `usage`).
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

## Adding a provider

1. Add its id to `PROVIDER_IDS` in `packages/protocol/src/index.ts` (and bump `PROTOCOL_VERSION`
   only if the wire format changes).
2. Implement `Provider` in `packages/bridge/src/providers/<name>.ts`.
3. Register it in `providers/registry.ts`.
4. Add its card copy to `apps/desktop/src/lib/providers.ts`.
5. Add tests with a scripted fake process or fetch (see `providers.test.ts`).
6. Document the official sign-in route and its limits here **before** shipping it.
