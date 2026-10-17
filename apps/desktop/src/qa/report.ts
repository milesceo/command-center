import { QA_ITEMS, AREA_LABELS, type QaItem } from './checklist';

export type QaStatus = 'pass' | 'fail' | 'skip';

export interface QaResult {
  status: QaStatus;
  note: string;
  /** Epoch ms. */
  at: number;
  /** The item's `rev` when it was answered; a different `rev` makes the result stale. */
  rev: number;
}

export type QaResults = Record<string, QaResult>;

export interface QaEnvironment {
  appVersion: string;
  bridge: string;
  platform: string;
  tier: string;
  theme: string;
  motion: string;
  desktop: boolean;
}

export const REPO_ISSUES_URL = 'https://github.com/milesceo/command-center/issues/new';

/** A result only counts while the question it answered is unchanged. */
export function currentResult(item: QaItem, results: QaResults): QaResult | null {
  const result = results[item.id];
  return result && result.rev === item.rev ? result : null;
}

export interface Summary {
  total: number;
  pass: number;
  fail: number;
  skip: number;
  untested: number;
}

export function summarize(items: readonly QaItem[], results: QaResults): Summary {
  const out: Summary = { total: items.length, pass: 0, fail: 0, skip: 0, untested: 0 };
  for (const item of items) {
    const status = currentResult(item, results)?.status;
    if (status) out[status] += 1;
    else out.untested += 1;
  }
  return out;
}

export function environmentText(env: QaEnvironment): string {
  return [
    `Command Center ${env.appVersion}${env.desktop ? '' : ' (browser preview)'}`,
    `Bridge: ${env.bridge}`,
    `Platform: ${env.platform}`,
    `Tier: ${env.tier}, theme: ${env.theme}, animations: ${env.motion}`,
  ].join('\n');
}

/**
 * A GitHub "new issue" link prefilled from a failed item. GitHub issue forms accept field ids as
 * query parameters, so the QA failure template arrives filled in; nothing is sent until the user
 * presses Submit on GitHub (no token, no API call from the app).
 */
export function issueUrl(item: QaItem, note: string, env: QaEnvironment): string {
  const params = new URLSearchParams({
    template: 'qa-failure.yml',
    title: `QA ${item.id}: ${item.title}`,
    labels: `qa-failure,needs-triage,area:${item.area}`,
    item: item.id,
    expected: item.expected,
    actual: note || '(describe what you saw)',
    build: environmentText(env),
  });
  return `${REPO_ISSUES_URL}?${params.toString()}`;
}

const MARK: Record<QaStatus | 'untested', string> = {
  pass: 'PASS',
  fail: 'FAIL',
  skip: 'SKIP',
  untested: '----',
};

/** A paste-able Markdown report of the current answers, grouped by area. */
export function resultsMarkdown(
  results: QaResults,
  env: QaEnvironment,
  items: readonly QaItem[] = QA_ITEMS,
): string {
  const s = summarize(items, results);
  const lines = [
    '# Command Center manual test results',
    '',
    '```text',
    environmentText(env),
    '```',
    '',
    `${s.pass} passed, ${s.fail} failed, ${s.skip} skipped, ${s.untested} not tested of ${s.total}.`,
    '',
  ];
  const areas = [...new Set(items.map((i) => i.area))];
  for (const area of areas) {
    lines.push(`## ${AREA_LABELS[area]}`, '');
    for (const item of items.filter((i) => i.area === area)) {
      const result = currentResult(item, results);
      const note = result?.note ? ` — ${result.note.replace(/\s+/g, ' ')}` : '';
      lines.push(`- \`${MARK[result?.status ?? 'untested']}\` **${item.id}** ${item.title}${note}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}
