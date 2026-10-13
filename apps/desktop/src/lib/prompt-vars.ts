/** `{{name}}` placeholders in prompts. Names start with a letter or underscore; spaces inside the braces are allowed. */
const VARIABLE = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

/** Unique variable names in order of first appearance. */
export function extractVariables(body: string): string[] {
  const seen = new Set<string>();
  for (const match of body.matchAll(VARIABLE)) seen.add(match[1] as string);
  return [...seen];
}

/** Substitutes values; a variable without a value becomes empty text. Values are inserted verbatim (never re-scanned for placeholders). */
export function renderPrompt(body: string, values: Record<string, string>): string {
  return body.replace(VARIABLE, (_match, name: string) => values[name] ?? '');
}

/** Variables that still have no (non-blank) value. */
export function missingVariables(body: string, values: Record<string, string>): string[] {
  return extractVariables(body).filter((name) => (values[name] ?? '').trim() === '');
}
