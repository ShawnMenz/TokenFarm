// First-run tutorial + per-update walkthroughs.
//
// The game repaints #app on every SSE tick (main.ts), so this overlay lives on
// document.body — outside the repainted region — and re-anchors its bubble+arrow
// to targets by re-querying selectors each reposition.
//
// Each step is tagged with the version that introduced it. A brand-new player
// sees every step; a returning player only sees steps newer than the version
// they last completed (stored in localStorage). That makes every MINOR release
// walk the player through just its new features.

const STORAGE_KEY = 'tokenfarm.tutorialVersion';

type Placement = 'auto' | 'top' | 'bottom' | 'left' | 'right';

interface Step {
  id: string;
  version: string; // semver in which this step's feature was introduced
  selector: string; // target element in the game view
  fallbackSelector?: string; // used if `selector` isn't present
  title: string;
  body: string; // may contain simple <b> markup
  placement?: Placement;
}

// Ordered list. Add new steps with the version they ship in; they slot in
// automatically for players updating from an older version.
export const TUTORIAL_STEPS: Step[] = [
  {
    id: 'coins',
    version: '0.1.0',
    selector: '.coins',
    title: '🪙 Coins',
    body: 'Your currency. Every token your coding agent burns is converted into coins you spend here to plant crops.',
    placement: 'bottom',
  },
  {
    id: 'codex-income',
    version: '0.1.0',
    selector: '.coins',
    title: '🤖 Two agents, one farm',
    body: 'TokenFarm listens to both <b>Claude Code and Codex</b>. Input, cache-creation, and output tokens from either local agent flow into this same coin balance.',
    placement: 'bottom',
  },
  {
    id: 'weather',
    version: '0.1.0',
    selector: '.weather',
    title: '☀️ Weather',
    body: 'Weather tells the story. <b>Sunny + agent active</b> = crops grow. <b>Sunny + idle</b> = crops at risk. <b>Rainy</b> = rest time, farm protected.',
    placement: 'bottom',
  },
  {
    id: 'blocked',
    version: '0.1.0',
    selector: '.blocked-toggle',
    title: "🌧️ I'm blocked",
    body: "Waiting on something outside your control? Flip this on — it forces rainy weather so your crops won't wilt while you're stuck. Fairness, not cheating.",
    placement: 'bottom',
  },
  {
    id: 'level',
    version: '0.1.0',
    selector: '.level',
    title: '⭐ Level & XP',
    body: 'Harvesting mature crops earns XP. Fill the bar to level up and grow your farm.',
    placement: 'bottom',
  },
  {
    id: 'field',
    version: '0.1.0',
    selector: '.field',
    fallbackSelector: '.plot',
    title: '🌾 Your plots',
    body: 'Plant 🌾 when you can afford it, watch it grow through the stages, then Harvest when it reads <b>Ready!</b>',
    placement: 'top',
  },
  {
    id: 'foot',
    version: '0.1.0',
    selector: '.foot',
    title: '⚙️ Difficulty & hours',
    body: 'Your difficulty multiplier and working window. Crops grow during your working hours — you set these during onboarding.',
    placement: 'top',
  },
];

// --- semver compare (major.minor.patch, numeric) ------------------------------
function parseVer(v: string): [number, number, number] {
  const [a = 0, b = 0, c = 0] = v.split('.').map((n) => parseInt(n, 10) || 0);
  return [a, b, c];
}
function semverGt(a: string, b: string): boolean {
  const pa = parseVer(a);
  const pb = parseVer(b);
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

// --- engine state -------------------------------------------------------------
let started = false; // guards one-run-per-page-load
let queue: Step[] = [];
let index = 0;
let els: {
  backdrop: HTMLElement;
  highlight: HTMLElement;
  bubble: HTMLElement;
  arrow: HTMLElement;
  title: HTMLElement;
  body: HTMLElement;
  counter: HTMLElement;
  next: HTMLButtonElement;
  skip: HTMLButtonElement;
} | null = null;

function currentTarget(): HTMLElement | null {
  const step = queue[index];
  if (!step) return null;
  return (
    document.querySelector<HTMLElement>(step.selector) ||
    (step.fallbackSelector
      ? document.querySelector<HTMLElement>(step.fallbackSelector)
      : null)
  );
}

function buildOverlay() {
  const backdrop = document.createElement('div');
  backdrop.className = 'tut-backdrop';

  const highlight = document.createElement('div');
  highlight.className = 'tut-highlight';

  const bubble = document.createElement('div');
  bubble.className = 'tut-bubble';

  const arrow = document.createElement('div');
  arrow.className = 'tut-arrow';

  const title = document.createElement('div');
  title.className = 'tut-title';

  const body = document.createElement('div');
  body.className = 'tut-body';

  const footer = document.createElement('div');
  footer.className = 'tut-footer';

  const counter = document.createElement('span');
  counter.className = 'tut-counter';

  const skip = document.createElement('button');
  skip.className = 'tut-skip';
  skip.type = 'button';
  skip.textContent = 'Skip';

  const next = document.createElement('button');
  next.className = 'tut-next';
  next.type = 'button';
  next.textContent = 'Go Next';

  footer.append(counter, skip, next);
  bubble.append(title, body, footer);

  next.addEventListener('click', () => {
    if (index >= queue.length - 1) finish();
    else showStep(index + 1);
  });
  skip.addEventListener('click', () => finish());

  document.body.append(backdrop, highlight, bubble, arrow);

  els = { backdrop, highlight, bubble, arrow, title, body, counter, next, skip };
}

function teardownOverlay() {
  if (!els) return;
  els.backdrop.remove();
  els.highlight.remove();
  els.bubble.remove();
  els.arrow.remove();
  els = null;
}

function showStep(i: number) {
  index = i;
  const step = queue[index];
  if (!step || !els) return finish();

  // Skip steps whose target isn't in the DOM (e.g. a hidden feature).
  if (!currentTarget()) {
    if (index >= queue.length - 1) return finish();
    return showStep(index + 1);
  }

  els.title.innerHTML = step.title;
  els.body.innerHTML = step.body;
  els.counter.textContent = `${index + 1} / ${queue.length}`;
  els.next.textContent = index >= queue.length - 1 ? 'Done' : 'Go Next';
  reposition();
}

// Positions the highlight ring, bubble, and arrow against the current target.
// Called on show, on resize/scroll, and after each game repaint.
export function reposition() {
  if (!els) return;
  const target = currentTarget();
  if (!target) return;

  const r = target.getBoundingClientRect();
  const pad = 6;

  // Spotlight ring over the target.
  els.highlight.style.left = `${r.left - pad}px`;
  els.highlight.style.top = `${r.top - pad}px`;
  els.highlight.style.width = `${r.width + pad * 2}px`;
  els.highlight.style.height = `${r.height + pad * 2}px`;

  // Decide placement: prefer requested, fall back to whichever side has room.
  const bubbleRect = els.bubble.getBoundingClientRect();
  const bw = bubbleRect.width || 300;
  const bh = bubbleRect.height || 140;
  const gap = 14;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const requested = queue[index]?.placement ?? 'auto';
  let placement: Exclude<Placement, 'auto'>;
  if (requested !== 'auto') {
    placement = requested;
  } else {
    placement = r.bottom + gap + bh <= vh ? 'bottom' : 'top';
  }
  // If chosen vertical placement doesn't fit, flip it.
  if (placement === 'bottom' && r.bottom + gap + bh > vh && r.top - gap - bh >= 0) {
    placement = 'top';
  } else if (placement === 'top' && r.top - gap - bh < 0 && r.bottom + gap + bh <= vh) {
    placement = 'bottom';
  }

  let bx: number;
  let by: number;
  let ax: number;
  let ay: number;
  let arrowClass = 'tut-arrow-up';

  if (placement === 'top' || placement === 'bottom') {
    bx = r.left + r.width / 2 - bw / 2;
    bx = Math.max(8, Math.min(bx, vw - bw - 8));
    if (placement === 'bottom') {
      by = r.bottom + gap;
      arrowClass = 'tut-arrow-up'; // arrow on top edge of bubble, pointing up to target
      ay = by - 7;
    } else {
      by = r.top - gap - bh;
      arrowClass = 'tut-arrow-down';
      ay = by + bh - 1;
    }
    ax = r.left + r.width / 2 - 7;
    ax = Math.max(bx + 10, Math.min(ax, bx + bw - 24));
  } else {
    by = r.top + r.height / 2 - bh / 2;
    by = Math.max(8, Math.min(by, vh - bh - 8));
    if (placement === 'right') {
      bx = r.right + gap;
      arrowClass = 'tut-arrow-left';
      ax = bx - 7;
    } else {
      bx = r.left - gap - bw;
      arrowClass = 'tut-arrow-right';
      ax = bx + bw - 1;
    }
    ay = r.top + r.height / 2 - 7;
  }

  els.bubble.style.left = `${bx}px`;
  els.bubble.style.top = `${by}px`;
  els.arrow.className = `tut-arrow ${arrowClass}`;
  els.arrow.style.left = `${ax}px`;
  els.arrow.style.top = `${ay}px`;
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === 'Escape') finish();
}

function finish() {
  teardownOverlay();
  window.removeEventListener('resize', reposition);
  window.removeEventListener('scroll', reposition, true);
  window.removeEventListener('keydown', onKey);
  try {
    localStorage.setItem(STORAGE_KEY, __APP_VERSION__);
  } catch {
    /* localStorage unavailable — nothing to persist */
  }
}

/**
 * Start the tutorial if the player hasn't seen the current version's steps.
 * Runs at most once per page load. Call after onboarding, in game mode.
 * Pass { force: true } to replay every step regardless of stored progress.
 */
export function maybeStartTutorial(opts: { force?: boolean } = {}) {
  if (started && !opts.force) return;

  let seen: string | null = null;
  try {
    seen = localStorage.getItem(STORAGE_KEY);
  } catch {
    seen = null;
  }

  if (opts.force) {
    queue = [...TUTORIAL_STEPS];
  } else if (seen === __APP_VERSION__) {
    started = true;
    return; // already caught up
  } else if (seen === null) {
    queue = [...TUTORIAL_STEPS]; // first-time player: full tour
  } else {
    queue = TUTORIAL_STEPS.filter((s) => semverGt(s.version, seen!));
  }

  started = true;

  if (queue.length === 0) {
    // e.g. a PATCH-only bump with no new steps — mark caught up, show nothing.
    finish();
    return;
  }

  // A live overlay from a previous run (force replay) is torn down first.
  teardownOverlay();
  buildOverlay();
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  window.addEventListener('keydown', onKey);
  showStep(0);
}

/** Clears stored progress and replays the whole tour. Wired to the badge click. */
export function replayTutorial() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  maybeStartTutorial({ force: true });
}

/** True while a tutorial overlay is on screen. */
export function isTutorialActive(): boolean {
  return els !== null;
}

/** Re-anchor the overlay to its target; safe to call when inactive. */
export function repositionTutorial() {
  if (els) reposition();
}
