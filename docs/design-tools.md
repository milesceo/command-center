# Design tools

Two tools, for two jobs. Both are optional; the app builds and tests without them.

| Tool          | Use it for                                                                                                                                         | Where the source of truth lives                                         |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| **Storybook** | Tuning a component or a screen in every state, in both themes, with every palette, density, animation level and performance tier from the toolbar. | The code. A story is the component.                                     |
| **Figma**     | Composing layouts and exploring visual direction on a canvas before (or instead of) editing code.                                                  | The Figma file, with variables imported from `docs/design/tokens.json`. |

Claude can read both: Storybook through its MCP server, Figma through Figma's MCP server.

## Storybook

```bash
pnpm storybook
```

Open **http://localhost:6006/** for the component workshop (try
`http://localhost:6006/?path=/story/pin-pincircles--revealed`). `http://localhost:6006/mcp` is
**not** the workshop: it is the endpoint Claude connects to, and in a browser it only shows a page
listing the MCP toolsets (docs, development, testing). If that is all you see, you opened `/mcp`.

- The toolbar sets **Theme, Palette, Density, Motion and Tier**. These write into the real prefs
  store, so components react exactly as they do in the app.
- Stories live next to the code (`*.stories.tsx`): UI primitives, the PIN circles, status dots,
  the logo, every onboarding step, the lock screen, the splash, and each Settings section.
- Use the **Controls** panel to change a story's props and the **Accessibility** panel for the
  axe results of what is on screen.
- To add one, create `Component.stories.tsx` beside the component. If it reads a store, set the
  store in the story (see `StatusDot.stories.tsx`).

### Claude and Storybook (MCP)

`.mcp.json` registers the Storybook MCP server at `http://localhost:6006/mcp`. Start Storybook
first (`pnpm storybook`), then Claude Code can list components, read their documentation and
stories, and run story tests. Claude Code asks you to approve a project MCP server the first time.

The workflow this enables: you open Storybook, nudge a control until it looks right, and tell
Claude the story and the values ("PinCircles / Revealed, gap 6px, circle 36px"); Claude changes
the code and the story reflects it.

## Figma

Figma needs your account, so setup is two steps on your side.

1. **Connect Claude to Figma.** Install the official plugin from Claude Code:

   ```bash
   claude plugin install figma@claude-plugins-official
   ```

   then authorize your Figma account when prompted. (Figma's desktop-app MCP server is the
   alternative for organization plans: enable it in Figma's Dev Mode inspector, it serves
   `http://127.0.0.1:3845/mcp`.) With it Claude can read frames, components and variables,
   generate code from a selected frame, and write back to the canvas.

2. **Bring the tokens in.** `docs/design/tokens.json` is generated from the app
   (`pnpm design:tokens`) and holds the dark and light theme colors, every palette's neutrals and
   accent, the accent swatches, radii and fonts. Import `themes.dark` and `themes.light` as two
   modes of one variable collection with a variables importer (Tokens Studio, or Figma's own JSON
   import), so a frame in Figma uses the same values the app does.

### Using Figma with Claude

- Name frames after screens (`Lock screen`, `Onboarding / Look & feel`) and components after the
  code (`PinCircles`, `StatusDot`). Claude maps names to files more reliably that way.
- Share a frame link in a **UI feedback** issue (template `ui-feedback.yml`) or in chat and say
  what to match. Claude reads the frame, not a screenshot.
- Prefer variables over hard-coded colors; when a color is wrong, fix the variable and the token
  export, not one frame.

## Keeping it honest

- `pnpm check` fails if `docs/design/tokens.json` is stale (`pnpm design:tokens` refreshes it).
- Storybook builds in CI as part of `pnpm check` only through type checking; run
  `pnpm --filter @geeked/desktop build-storybook` to build the static site.
