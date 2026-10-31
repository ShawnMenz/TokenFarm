import { action, subscribe, type Snapshot } from './api.js';
import { renderGame, renderOnboarding, renderDaySelector, difficultyBlurb } from './render.js';
import { maybeStartTutorial, repositionTutorial, replayTutorial, refreshTutorialText } from './tutorial.js';
import { getLang, setLang, onLangChange, t } from './i18n.js';

const app = document.getElementById('app')!;
let latest: Snapshot | null = null;
let mode: 'none' | 'onboarding' | 'game' = 'none';

// Version badge (bottom-right) — value injected from package.json at build time.
const badge = document.getElementById('version-badge');
if (badge) {
  badge.textContent = `v ${__APP_VERSION__}`;
  badge.addEventListener('click', () => replayTutorial());
}

// Language toggle (beside the badge). Flips English⇄中文 and persists the choice;
// the onLangChange handler below re-renders everything into the new language.
const langToggle = document.getElementById('lang-toggle');
langToggle?.addEventListener('click', () => setLang(getLang() === 'en' ? 'zh' : 'en'));

function devInputFocused(): boolean {
  const active = document.activeElement;
  return active instanceof HTMLElement && active.classList.contains('dev-input');
}

function paintGame(snap: Snapshot) {
  // In dev mode several controls are editable inputs/sliders/selects. #app is
  // repainted every tick, which would wipe a control and drop focus mid-edit, so
  // skip the repaint while any dev control is focused. Repaints resume once it
  // blurs (which also commits the value — see the 'change' handler below).
  if (devInputFocused()) return;
  app.innerHTML = renderGame(snap);
  // #app is fully repainted each tick; re-anchor the tutorial to the new nodes.
  repositionTutorial();
}

const WEEKDAYS = [1, 2, 3, 4, 5];
const WEEKEND = [6, 0];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function paintOnboarding(snap: Snapshot) {
  app.innerHTML = renderOnboarding(snap);

  // The working-days selector defaults to the weekdays and self-groups: completing
  // a whole block (all weekdays, both weekend days, or every day) collapses it into
  // one chip. The set below is the source of truth, re-rendered on every change.
  const selectedDays = new Set<number>(WEEKDAYS);
  const selector = document.getElementById('day-selector')!;
  const dayError = document.getElementById('day-error')!;

  selector.addEventListener('change', (ev) => {
    const input = ev.target as HTMLInputElement;
    if (input.dataset.day !== undefined) {
      const d = Number(input.dataset.day);
      if (input.checked) selectedDays.add(d);
      else selectedDays.delete(d);
    } else if (input.dataset.group) {
      const group =
        input.dataset.group === 'everyday'
          ? ALL_DAYS
          : input.dataset.group === 'weekdays'
            ? WEEKDAYS
            : WEEKEND;
      // Group chips render checked; unchecking one expands it back to empty days.
      for (const d of group) input.checked ? selectedDays.add(d) : selectedDays.delete(d);
    } else {
      return;
    }
    selector.innerHTML = renderDaySelector([...selectedDays]);
    if (selectedDays.size > 0) dayError.hidden = true;
  });

  // Update the difficulty explanation as the selection changes.
  const difficultySelect = document.getElementById('difficulty') as HTMLSelectElement;
  const difficultyNote = document.getElementById('difficulty-note')!;
  const mults = (snap.difficultyMultipliers ?? {}) as Record<string, number>;
  difficultySelect.addEventListener('change', () => {
    difficultyNote.textContent = difficultyBlurb(difficultySelect.value, mults[difficultySelect.value] ?? 1);
  });

  document.getElementById('start')!.addEventListener('click', async () => {
    const difficulty = (document.getElementById('difficulty') as HTMLSelectElement).value;
    const startHour = Number((document.getElementById('startHour') as HTMLInputElement).value);
    const endHour = Number((document.getElementById('endHour') as HTMLInputElement).value);
    const days = [...selectedDays].sort((a, b) => a - b);
    if (days.length === 0) {
      dayError.hidden = false; // require at least one working day
      return;
    }
    await action('onboard', { difficulty, workingHours: { startHour, endHour, days } });
  });
}

// ---- developer mode controls ----
// The Restart button lives on document.body (outside #app) so the per-tick
// repaint can't wipe it; it's only shown when the server reports dev mode.
const devRestartBtn = document.createElement('button');
devRestartBtn.className = 'dev-restart';
devRestartBtn.type = 'button';
devRestartBtn.textContent = t('devRestart');
devRestartBtn.style.display = 'none';
devRestartBtn.addEventListener('click', async () => {
  const ok = await confirmDialog(t('restartConfirm'), t('restartLabel'));
  if (ok) await action('restart');
});
document.body.appendChild(devRestartBtn);

// Left-side "fake token flow" box (dev only). Inject a token burst through the real
// ingestion path to watch coins accrue and tune the conversion divisor. Lives on
// document.body so the per-tick #app repaint never wipes the inputs.
const devTokenBox = document.createElement('div');
devTokenBox.className = 'dev-token-box';
devTokenBox.style.display = 'none';
// Field names are the literal provider API keys, so they stay untranslated; only
// the title, preview, and button are localized (refreshed in applyStaticLabels).
devTokenBox.innerHTML = `
  <div class="dtb-title">${t('devTokenTitle')}</div>
  <label class="dtb-row">input_tokens<input class="dtb-in dtb-field" type="number" min="0" step="1" value="0"></label>
  <label class="dtb-row">cache_creation_input_tokens<input class="dtb-cc dtb-field" type="number" min="0" step="1" value="0"></label>
  <label class="dtb-row">output_tokens<input class="dtb-out dtb-field" type="number" min="0" step="1" value="0"></label>
  <div class="dtb-preview"></div>
  <button class="dtb-inject" type="button">${t('devTokenInject')}</button>`;
document.body.appendChild(devTokenBox);
const dtbIn = devTokenBox.querySelector('.dtb-in') as HTMLInputElement;
const dtbCc = devTokenBox.querySelector('.dtb-cc') as HTMLInputElement;
const dtbOut = devTokenBox.querySelector('.dtb-out') as HTMLInputElement;
const dtbPreview = devTokenBox.querySelector('.dtb-preview') as HTMLElement;

function dtbNum(el: HTMLInputElement): number {
  const n = Number(el.value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
// Preview the coin yield for the entered tokens at the current divisor/difficulty.
function updateTokenPreview(): void {
  const snap = latest as any;
  const sum = dtbNum(dtbIn) + dtbNum(dtbCc) + dtbNum(dtbOut);
  const divisor = snap?.conversionDivisor ?? 200; // prices.json conversionDivisor
  const mult = snap?.difficultyMultipliers?.[snap?.difficulty] ?? 1;
  const coins = (sum * mult) / divisor;
  dtbPreview.textContent = t('devTokenPreview', sum.toLocaleString(), coins.toFixed(2), divisor, mult);
}
devTokenBox.addEventListener('input', updateTokenPreview);
devTokenBox.querySelector('.dtb-inject')!.addEventListener('click', async () => {
  await action('injectTokens', {
    input_tokens: dtbNum(dtbIn),
    cache_creation_input_tokens: dtbNum(dtbCc),
    output_tokens: dtbNum(dtbOut),
  });
});
updateTokenPreview();

// Refresh the persistent, body-level controls (which live outside #app and so are
// not repainted each tick) into the current language.
function applyStaticLabels() {
  devRestartBtn.textContent = t('devRestart');
  (devTokenBox.querySelector('.dtb-title') as HTMLElement).textContent = t('devTokenTitle');
  (devTokenBox.querySelector('.dtb-inject') as HTMLElement).textContent = t('devTokenInject');
  if (langToggle) langToggle.textContent = t('langToggle');
  updateTokenPreview();
}

// On a language switch, re-render the active view immediately (don't wait for the
// next SSE tick), refresh the out-of-#app controls, and update the live tour.
onLangChange(() => {
  applyStaticLabels();
  refreshTutorialText();
  if (latest) {
    if (mode === 'onboarding') paintOnboarding(latest);
    else if (mode === 'game') paintGame(latest);
  }
});

// Apply the persisted (or default) language on load: sets <html lang>, the toggle
// label, and the dev-control labels. #app itself already renders in the stored
// language because render.ts reads it directly.
setLang(getLang());

subscribe((snap) => {
  latest = snap;
  // Show the dev Restart button + token box whenever the server reports dev mode.
  devRestartBtn.style.display = snap.devMode ? '' : 'none';
  devTokenBox.style.display = snap.devMode ? '' : 'none';
  if (snap.devMode) updateTokenPreview(); // reflect divisor/difficulty changes
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

// Commit dev-control edits when a field changes (fires on blur/Enter for inputs,
// on release for sliders, on pick for selects). Delegated on #app because the
// controls are repainted each tick. `data-dev-field` selects the action.
app.addEventListener('change', async (ev) => {
  const el = ev.target as HTMLElement;
  if (!el.classList.contains('dev-input')) return;
  const field = (el as HTMLInputElement | HTMLSelectElement).dataset.devField;
  const value = (el as HTMLInputElement | HTMLSelectElement).value;
  const plotId = Number((el as HTMLElement).dataset.plot);
  const num = Number(value);
  switch (field) {
    case 'coins':
      if (Number.isFinite(num) && num >= 0) await action('setCoins', { amount: num });
      break;
    case 'xp':
      if (Number.isFinite(num) && num >= 0) await action('setXp', { amount: num });
      break;
    case 'level':
      if (Number.isFinite(num) && num >= 1) await action('setLevel', { amount: num });
      break;
    case 'growth':
      await action('setGrowth', { plotId, progress: num / 100 });
      break;
    case 'plotState':
      await action('setPlotState', { plotId, state: value });
      break;
    case 'weather':
      await action('setWeather', { weather: value });
      break;
  }
});
// Enter commits a focused numeric dev input by blurring it (fires 'change').
app.addEventListener('keydown', (ev) => {
  const el = ev.target as HTMLElement;
  if (ev.key === 'Enter' && el instanceof HTMLInputElement && el.classList.contains('dev-input')) {
    el.blur();
  }
});

// A small styled yes/no dialog. Lives on document.body (outside #app), so the
// per-tick repaint of #app can't wipe it. Resolves true on confirm, false otherwise.
function confirmDialog(message: string, confirmLabel: string = t('remove')): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop confirm-backdrop';
    backdrop.innerHTML = `
      <div class="modal confirm-modal">
        <p class="confirm-msg"></p>
        <div class="confirm-actions">
          <button class="confirm-cancel" type="button">${t('confirmCancel')}</button>
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
  } else if (name === 'buySeed') {
    await action('buySeed', { cropId: btn.dataset.crop });
  } else if (name === 'plant') {
    await action('plant', { plotId: Number(btn.dataset.plot), cropId: btn.dataset.crop });
  } else if (name === 'harvest') {
    await action('harvest', { plotId: Number(btn.dataset.plot) });
  } else if (name === 'clear') {
    const wilting = btn.dataset.state === 'wilted';
    const message = wilting ? t('clearWilting') : t('clearDead');
    if (await confirmDialog(message)) {
      await action('clear', { plotId: Number(btn.dataset.plot) });
    }
  } else if (name === 'toggleBlocked') {
    await action('toggleBlocked');
  } else if (name === 'buyItem') {
    await action('buyItem', { itemId: btn.dataset.item });
  } else if (name === 'applyItem') {
    await action('applyItem', { plotId: Number(btn.dataset.plot), itemId: btn.dataset.item });
  } else if (name === 'upgradeField') {
    await action('upgradeField', { plotId: Number(btn.dataset.plot) });
  } else if (name === 'buyTool') {
    await action('buyTool', { toolId: btn.dataset.tool });
  } else if (name === 'toggleTool') {
    await action('toggleTool', { toolId: btn.dataset.tool });
  } else if (name === 'buyPower') {
    await action('buyPower');
  }
});
