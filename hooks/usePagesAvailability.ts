import { useCallback, useEffect, useState } from 'react';
import { API_BASE_URL, authFetch } from '../services/api';

/** Navigation hint only; Page requests remain server-authorized. */
export function usePagesAvailability(viewerId?: string, enabled = true) {
  const sessionKey = `${viewerId || 'guest'}:${localStorage.getItem('si_token') || ''}`;
  const [result, setResult] = useState({ sessionKey: '', available: false, loading: true });
  const [revision, setRevision] = useState(0);
  const retry = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller?.abort();
      const request = controller = new AbortController();
      try {
        const response = await authFetch(`${API_BASE_URL}/pages/availability`, {
          signal: request.signal, timeoutMs: 10_000, cache: 'no-store'
        });
        const body = response.ok ? await response.json() : null;
        if (active && !request.signal.aborted) setResult({ sessionKey, available: body?.available === true, loading: false });
      } catch {
        if (active && !request.signal.aborted) setResult({ sessionKey, available: false, loading: false });
      }
    };
    const onFocus = () => {
      setResult({ sessionKey, available: false, loading: true });
      void refresh();
    };
    const onVisible = () => { if (document.visibilityState === 'visible') onFocus(); };
    const onSession = (event: StorageEvent) => { if (!event.key || event.key === 'si_token' || event.key === 'si_user') retry(); };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onSession);
    window.addEventListener('auth_expired', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onSession);
      window.removeEventListener('auth_expired', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [sessionKey, enabled, revision, retry]);
  const current = enabled && result.sessionKey === sessionKey;
  return { available: current && result.available, loading: enabled && (!current || result.loading), retry };
}
