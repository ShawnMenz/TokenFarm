import type { GameState } from './state.js';

export type Weather = 'sunny' | 'rainy';

// Two states only. Rainy = rest time (off-hours / weekend / "I'm blocked") — the
// farm is protected. Sunny = working hours — growth happens and the wilt clock can
// tick.
export function weatherNow(state: GameState, now: number = Date.now()): Weather {
  if (state.manualBlocked) return 'rainy';
  const d = new Date(now);
  const day = d.getDay();
  const hour = d.getHours() + d.getMinutes() / 60;
  const { startHour, endHour, days } = state.workingHours;
  const working = days.includes(day) && hour >= startHour && hour < endHour;
  return working ? 'sunny' : 'rainy';
}
