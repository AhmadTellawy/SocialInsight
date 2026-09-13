import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { usePostFollowState } from '../../hooks/usePostFollowState';

// This supplemental harness executes the real hook. Main journeys run the real App.
function FollowProbe() {
  const [viewer, setViewer] = useState('post-options-viewer');
  const [events, setEvents] = useState(0);
  const [completed, setCompleted] = useState(0);
  const state = usePostFollowState(viewer, 'post-options-owner', false);
  useEffect(() => {
    const receive = () => setEvents(n => n + 1);
    window.addEventListener('onFollowStateChange', receive);
    return () => window.removeEventListener('onFollowStateChange', receive);
  }, []);
  return <main>
    <p data-testid="viewer">{viewer}</p>
    <p data-testid="relationship">{state.status}</p>
    <p data-testid="ready">{String(state.ready && !state.loading)}</p>
    <p data-testid="events">{events}</p>
    <p data-testid="completed">{completed}</p>
    <button onClick={() => { void state.toggle().finally(() => setCompleted(n => n + 1)); }} disabled={state.loading}>Toggle follow</button>
    <button onClick={() => {
      localStorage.setItem('si_user', JSON.stringify({ id: 'synthetic-switched-viewer' }));
      localStorage.setItem('si_token', 'synthetic-switched-token');
      setViewer('synthetic-switched-viewer');
    }}>Switch account</button>
  </main>;
}
createRoot(document.getElementById('root')!).render(<FollowProbe />);
