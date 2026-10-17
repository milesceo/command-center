# Prompts

This folder holds the prompts used to build Command Center, one file per prompt, saved verbatim.

## Naming

`YYYY-MM-DD-topic.md`, for example `2026-10-17-subagents.md` or `2026-10-17-home-page.md`. The date is the day the session started; the topic is a short kebab-case label. If two prompts share a day and topic, add a suffix (`-2`).

## Binding rules

- A prompt's requirements and "done when" items **stay binding** after its session ends, unless a later prompt overrides them.
- Where two prompts conflict, the newer one wins (compare the dates in the file names).
- Prompts rank below `CLAUDE.md` and above the other docs in the rule hierarchy the Regulator subagent enforces:
  1. The current session's prompt
  2. `CLAUDE.md`
  3. Prompts in this folder (newer overrides older)
  4. Other docs (`docs/*.md`) and established conventions in the code

## Workflow

- Every new session saves its prompt here **as the first commit of its branch**, before any code is written (commit type `docs:`).
- Past prompts that only exist in chat history are added by the owner.
- Save the prompt as written. Do not summarize or "clean it up"; if something needs correcting (a repo name that has since changed, say), add a short note at the end of the file instead of editing the original text.
- Prompts are the record of intent. Do not delete one; supersede it with a later prompt.
