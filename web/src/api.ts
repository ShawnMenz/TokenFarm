// Thin client for the game server: SSE for live state, POST for actions.

export type Snapshot = any;

export function subscribe(onState: (snap: Snapshot) => void): EventSource {
  const es = new EventSource('/events');
  es.onmessage = (ev) => {
    try {
      onState(JSON.parse(ev.data));
    } catch {
      /* ignore keep-alive / malformed frames */
    }
  };
  return es;
}

export async function action(name: string, body: Record<string, unknown> = {}) {
  const res = await fetch('/action/' + name, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}
