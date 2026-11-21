import { useEffect, useState } from 'react';
import type { HealthResponse } from '@mdw/shared';
import { fetchHealth } from './api/client';

type HealthState =
  | { kind: 'loading' }
  | { kind: 'ok'; data: HealthResponse }
  | { kind: 'error'; message: string };

export function App() {
  const [health, setHealth] = useState<HealthState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    fetchHealth()
      .then((data) => {
        if (!cancelled) setHealth({ kind: 'ok', data });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Unknown error';
          setHealth({ kind: 'error', message });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 720 }}>
      <h1>Multi-Document Intelligence Workbench</h1>
      <section aria-label="Server status">
        <h2>Server status</h2>
        {health.kind === 'loading' && <p>Checking server…</p>}
        {health.kind === 'error' && <p role="alert">Server unreachable: {health.message}</p>}
        {health.kind === 'ok' && (
          <ul>
            <li>Status: <strong>{health.data.status}</strong></li>
            <li>Service: {health.data.service}</li>
            <li>Uptime: {health.data.uptimeSeconds}s</li>
            <li>Checked at: {health.data.timestamp}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
