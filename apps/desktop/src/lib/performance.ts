/**
 * Performance tiers. Everything the tier slider controls is declared here, in one place:
 * add a flag to `TierFlags`, give every tier a value, and describe it in `summarizeTier`.
 *
 * WIRED flags are read by a consumer today; TODO flags are stored and shown but nothing reads
 * them yet (search the codebase for the flag name to find the TODO consumer).
 */

export const TIER_IDS = ['lightest', 'light', 'balanced', 'enhanced', 'accelerated'] as const;
export type TierId = (typeof TIER_IDS)[number];
export const DEFAULT_TIER: TierId = 'balanced';

/** The most animation a tier allows; the user's animation setting can only go lower. */
export type MotionCap = 'off' | 'reduced' | 'full';
export type HighlightDepth = 'off' | 'basic' | 'full';

export interface TierFlags {
  /** WIRED (`effectiveMotion`): ceiling on UI animation. */
  motion: MotionCap;
  /** WIRED (`CodeBlock` preview follow): re-run an open preview while its reply streams. */
  previewAutoRefresh: boolean;
  /** TODO consumer: `lib/highlight.ts` should skip or limit Shiki tokenizing by depth. */
  highlightDepth: HighlightDepth;
  /** TODO consumer: no indexer exists yet; search will use it when FTS5 lands. */
  backgroundIndexing: boolean;
  /** WIRED (`data-glass` on <html>, styles/index.css): frosted/blurred panes. */
  glass: boolean;
  /** WIRED (`AsciiLogo`, `AsciiBackdrop`): frames per second; 0 draws one still frame. */
  asciiFps: number;
}

export interface Tier {
  id: TierId;
  label: string;
  blurb: string;
  flags: TierFlags;
}

export const TIERS: Readonly<Record<TierId, Tier>> = {
  lightest: {
    id: 'lightest',
    label: 'Lightest',
    blurb: 'Least CPU and battery. Static visuals, minimal effects.',
    flags: {
      motion: 'off',
      previewAutoRefresh: false,
      highlightDepth: 'off',
      backgroundIndexing: false,
      glass: false,
      asciiFps: 0,
    },
  },
  light: {
    id: 'light',
    label: 'Light',
    blurb: 'Gentle motion, basic highlighting, no blur.',
    flags: {
      motion: 'reduced',
      previewAutoRefresh: false,
      highlightDepth: 'basic',
      backgroundIndexing: false,
      glass: false,
      asciiFps: 6,
    },
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    blurb: 'The default: smooth, with live previews and full highlighting.',
    flags: {
      motion: 'full',
      previewAutoRefresh: true,
      highlightDepth: 'full',
      backgroundIndexing: false,
      glass: false,
      asciiFps: 12,
    },
  },
  enhanced: {
    id: 'enhanced',
    label: 'Enhanced',
    blurb: 'Adds glass effects and background indexing.',
    flags: {
      motion: 'full',
      previewAutoRefresh: true,
      highlightDepth: 'full',
      backgroundIndexing: true,
      glass: true,
      asciiFps: 20,
    },
  },
  accelerated: {
    id: 'accelerated',
    label: 'Accelerated',
    blurb: 'Everything on, at the highest frame rates.',
    flags: {
      motion: 'full',
      previewAutoRefresh: true,
      highlightDepth: 'full',
      backgroundIndexing: true,
      glass: true,
      asciiFps: 30,
    },
  },
};

export const isTierId = (value: unknown): value is TierId =>
  typeof value === 'string' && (TIER_IDS as readonly string[]).includes(value);

export const tierFlags = (id: TierId): TierFlags => TIERS[id].flags;

const MOTION_RANK: Record<MotionCap, number> = { off: 0, reduced: 1, full: 2 };

export type MotionSetting = 'system' | 'full' | 'reduced' | 'off';

/**
 * The animation level actually used: the user's choice (`system` follows the OS
 * reduced-motion setting), never above what the tier allows.
 */
export function effectiveMotion(
  setting: MotionSetting,
  cap: MotionCap,
  osPrefersReducedMotion: boolean,
): MotionCap {
  const wanted: MotionCap =
    setting === 'system' ? (osPrefersReducedMotion ? 'reduced' : 'full') : setting;
  return MOTION_RANK[wanted] <= MOTION_RANK[cap] ? wanted : cap;
}

/** A short on/off summary of a tier for the live text under the slider. */
export interface TierSummary {
  on: string[];
  off: string[];
}

const MOTION_TEXT: Record<MotionCap, string> = {
  off: 'Animations',
  reduced: 'Reduced animations',
  full: 'Full animations',
};

export function summarizeTier(id: TierId): TierSummary {
  const f = tierFlags(id);
  const on: string[] = [];
  const off: string[] = [];
  (f.motion === 'off' ? off : on).push(MOTION_TEXT[f.motion]);
  (f.previewAutoRefresh ? on : off).push('Live preview auto-refresh');
  if (f.highlightDepth === 'full') on.push('Full syntax highlighting');
  else if (f.highlightDepth === 'basic') on.push('Basic syntax highlighting');
  else off.push('Syntax highlighting');
  (f.backgroundIndexing ? on : off).push('Background indexing');
  (f.glass ? on : off).push('Blur and glass effects');
  if (f.asciiFps > 0) on.push(`ASCII animation at ${f.asciiFps} fps`);
  else off.push('ASCII animation (static frame)');
  return { on, off };
}
