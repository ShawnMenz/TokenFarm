import { action, subscribe, type Snapshot } from './api.js';
import { renderGame, renderOnboarding } from './render.js';
import { maybeStartTutorial, repositionTutorial, replayTutorial } from './tutorial.js';

const app = document.getElementById('app')!;
let latest: Snapshot | null = null;
let mode: 'none' | 'onboarding' | 'game' = 'none';

// Version badge (bottom-right) — value injected from package.json at build time.
const badge = document.getElementById('version-badge');
if (badge) {
  badge.textContent = `v ${__APP_VERSION__}`;
  badge.addEventListener('click', () => replayTutorial());
}

function paintGame(snap: Snapshot) {
  app.innerHTML = renderGame(snap);
  // #app is fully repainted each tick; re-anchor the tutorial to the new nodes.
  repositionTutorial();
}

function paintOnboarding(snap: Snapshot) {
  app.innerHTML = renderOnboarding(snap);
  document.getElementById('start')!.addEventListener('click', async () => {
    const difficulty = (document.getElementById('difficulty') as HTMLSelectElement).value;
    const startHour = Number((document.getElementById('startHour') as HTMLInputElement).value);
    const endHour = Number((document.getElementById('endHour') as HTMLInputElement).value);
    const days = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="day"]:checked'),
    ).map((el) => Number(el.value));
    await action('onboard', { difficulty, workingHours: { startHour, endHour, days } });
  });
}

subscribe((snap) => {
  latest = snap;
  if (!snap.onboarded) {
    // Render the onboarding form once; don't clobber it on every tick.
    if (mode !== 'onboarding') {
      mode = 'onboarding';
      paintOnboarding(snap);
    }
    return;
  }
  const enteringGame = mode !== 'game';
  mode = 'game';
  paintGame(snap);
  // Start the walkthrough once, only after onboarding is done (we're now in game
  // mode). maybeStartTutorial guards itself against re-running.
  if (enteringGame) maybeStartTutorial();
});

// A small styled yes/no dialog. Lives on document.body (outside #app), so the
// per-tick repaint of #app can't wipe it. Resolves true on confirm, false otherwise.
function confirmDialog(message: string, confirmLabel = 'Remove'): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop confirm-backdrop';
    backdrop.innerHTML = `
      <div class="modal confirm-modal">
        <p class="confirm-msg"></p>
        <div class="confirm-actions">
          <button class="confirm-cancel" type="button">Cancel</button>
          <button class="confirm-ok" type="button"></button>
        </div>
      </div>`;
    // Message/label set via textContent to avoid any HTML injection.
    backdrop.querySelector('.confirm-msg')!.textContent = message;
    backdrop.querySelector('.confirm-ok')!.textContent = confirmLabel;
    const close = (val: boolean) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      resolve(val);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(false);
    };
    backdrop.querySelector('.confirm-ok')!.addEventListener('click', () => close(true));
    backdrop.querySelector('.confirm-cancel')!.addEventListener('click', () => close(false));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false); // click outside the card cancels
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(backdrop);
  });
}

// Event delegation for all game actions.
app.addEventListener('click', async (ev) => {
  const btn = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (!btn || mode !== 'game') return;
  const name = btn.dataset.action!;
  if (name === 'plow') {
    await action('plow');
  } else if (name === 'plant') {
    await action('plant', { plotId: Number(btn.dataset.plot), cropId: btn.dataset.crop });
  } else if (name === 'harvest') {
    await action('harvest', { plotId: Number(btn.dataset.plot) });
  } else if (name === 'clear') {
    const wilting = btn.dataset.state === 'wilted';
    const message = wilting
      ? 'This crop is wilting — it could still recover if your agent gets active again. Remove it anyway? The plot returns to an empty field.'
      : 'Remove this dead crop? The plot returns to an empty field.';
    if (await confirmDialog(message)) {
      await action('clear', { plotId: Number(btn.dataset.plot) });
    }
  } else if (name === 'toggleBlocked') {
    await action('toggleBlocked');
  }
});
