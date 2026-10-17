<context>
Geeked (repo: engineerlish/programish) is my Tauri + React + TypeScript desktop app for working with multiple AI providers. Its end goal is to be the only app on a dedicated homelab machine that I control entirely through it. Read CLAUDE.md first and follow every rule in it, especially the git and attribution rules (all commits authored only by engineerlish, no Claude co-author trailers or "Generated with" lines anywhere).

I build Geeked with Claude Code using detailed phase prompts. This session adds a team of Claude Code subagents to the repo so future build sessions get specialist help: reviewing, testing, UI polish, and a regulator that keeps everything in line with my rules. These are development helpers for building Geeked, not a feature inside the app. Branch: `chore/subagents`.
</context>

<setup>
1. Check the current Claude Code documentation for your installed version on how project subagents are defined (file location, frontmatter fields such as name, description, tools and model, and how the main agent decides when to delegate). Follow the documented format exactly.
2. Create one file per agent in `.claude/agents/`. Write each description so it clearly states when the agent should be used, since that's what drives delegation.
3. Read the codebase, CLAUDE.md and existing docs first so each agent's instructions reference real conventions, folders, scripts and commands rather than generic advice.
</setup>

<source_of_truth>
The Regulator needs to know my original prompt guidelines, and right now those only live in my chat history. Create `docs/prompts/` with a README explaining that it holds the prompts used to build Geeked, one file per prompt, named by date and topic (e.g. `2026-10-17-home-page.md`), and that their requirements stay binding unless a later prompt overrides them. I'll add past prompts there myself; from now on, save each new session's prompt there as the first commit of its branch.

The Regulator's rule hierarchy, highest first:

1. The current session's prompt
2. CLAUDE.md
3. Prompts in `docs/prompts/` (newer overrides older where they conflict)
4. Other docs (`docs/*.md`) and established conventions in the code
   </source_of_truth>

<agents>
Reviewer
- Reviews diffs before they're committed: bugs, edge cases, error handling, security (especially anything touching the terminal, PIN, credentials or provider auth), performance, and adherence to existing patterns
- Flags any snippet-style or "rest unchanged" output; every file must be complete
- Read-only: reads files and runs git diff, but never edits. Returns findings grouped as must-fix, should-fix and nitpick, each with file, line and a concrete fix

Tester

- Writes and runs tests for new or changed behavior using the project's existing test setup (Vitest, cargo test), and actively tries to break features with edge cases, bad input and failure paths
- May create and edit test files only, never application code; if a bug needs an app fix, it reports the failing test and the likely cause
- Reports what it tested, what passed, what failed, and coverage gaps

UI Polish

- Checks UI changes against the design system: design tokens, spacing, typography, light and dark themes, tooltips and aria-labels on icon-only controls, keyboard navigation, focus states, empty/loading/error states, the animation setting, and the performance tiers
- Read-only; returns specific, actionable findings with file references and the fix

Regulator

- The final gate before anything is committed or pushed, and the keeper of the rules. Enforces the rule hierarchy above across everything the main agent and other subagents produce.
- Scope and requirements: checks the work against every requirement and "done when" item in the current prompt and the relevant earlier prompts, and flags anything missing, half-done, or added beyond scope without being asked
- Git rules: verifies author identity is engineerlish on every commit, no Claude attribution in commits, PR titles, PR bodies, tags or release notes, Conventional Commits format, correct branch naming, and nothing committed to main directly
- Documentation: keeps README, CHANGELOG, CLAUDE.md (including phase status) and relevant docs in sync with what changed, and saves the session prompt to `docs/prompts/`. It may edit documentation files only; for anything else it reports violations for the main agent to fix.
- Consistency: catches when the other agents' work contradicts an established decision (e.g. a library choice, a settings schema, a naming convention) and cites where that decision was made
- Returns a clear verdict: PASS, or BLOCKED with a numbered list of violations, each citing the rule and its source
</agents>

<workflow_in_claude_md>
Add a "Subagents" section to CLAUDE.md that tells the main agent how to use the team in every future session:

- Before writing code: save the session prompt to `docs/prompts/`
- After each meaningful change: Reviewer, plus UI Polish for any UI change
- Before marking a feature done: Tester
- Before every commit and every push: Regulator, and nothing is pushed until it returns PASS
- Fix must-fix findings before moving on; record should-fix items you defer in the PR description
- Subagents that are read-only must stay read-only; the main agent applies fixes so there are never conflicting edits
  </workflow_in_claude_md>

<verify>
Dry-run the team on the most recently merged PR: run Reviewer, Tester, UI Polish and Regulator against it and include their findings in this PR's description. Don't fix those findings in this branch; just confirm each agent triggers correctly, stays within its permissions, and produces useful output. Then run the Regulator on this branch itself before pushing.
</verify>

<git>
Small Conventional Commits, PR via `gh`, merge after CI passes and the Regulator returns PASS. Verify every commit's author and message per CLAUDE.md before pushing.
</git>

<done_when>

- [ ] Four agent files in `.claude/agents/` in the documented format, with tool permissions matching their roles
- [ ] `docs/prompts/` exists with its README
- [ ] CLAUDE.md has the Subagents workflow section
- [ ] Dry-run findings for all four agents are in the PR description
- [ ] Regulator returns PASS on this branch, CI green, PR merged
      </done_when>

<code_standards>
Write complete files, never snippets or "rest unchanged" placeholders.
</code_standards>

<report>
End with: a one-line summary of each agent, the most useful finding each produced in the dry run, any tuning you'd suggest for their instructions, and the PR link.
</report>
