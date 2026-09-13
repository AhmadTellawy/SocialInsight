import { useCallback } from 'react';
import { useLocation, useNavigate, type NavigateOptions, type To } from 'react-router-dom';
import { hasAppPredecessor } from '../utils/navigation';

/** Use the router's same-document index, never global browser history length. */
export function useAppNavigation() {
  const routerNavigate = useNavigate();
  const location = useLocation();
  const navigate = useCallback((to: To | number, options?: NavigateOptions) => {
    if (typeof to === 'number') return routerNavigate(to);
    if (typeof to === 'string' && to === `${location.pathname}${location.search}${location.hash}` && !options?.replace) return;
    return routerNavigate(to, options);
  }, [routerNavigate, location.pathname, location.search, location.hash]);
  const back = useCallback((fallback = '/') => {
    if (hasAppPredecessor(window.history.state)) void routerNavigate(-1);
    else void routerNavigate(fallback, { replace: true });
  }, [routerNavigate]);
  const setQuery = useCallback((name: string, value: string | null, replace = false) => {
    const query = new URLSearchParams(location.search);
    if (value === null) query.delete(name); else query.set(name, value);
    const search = query.toString();
    void navigate(`${location.pathname}${search ? `?${search}` : ''}${location.hash}`, { replace });
  }, [location.pathname, location.search, location.hash, navigate]);
  return { navigate, back, setQuery };
}
