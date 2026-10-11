import { useLayoutEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { capturePosition, navigationViewer, readPosition } from '../utils/journeyNavigation';
import { restoreScroll, readResume } from '../utils/appResume';
import { startJourney } from '../utils/journeyPerformance';

/** Every browser history entry owns its position, including repeated visits to one URL. */
export function useJourneyNavigation(viewer: string, enabled: boolean) {
  const location = useLocation();
  const coldResume=useRef(true);
  const entry = location.key + ':' + location.pathname + location.search;
  const latest = useRef({entry,path:location.pathname}); latest.current = {entry,path:location.pathname};
  useLayoutEffect(() => {
    navigationViewer(viewer);
    if (!enabled) return;
    const cold=coldResume.current?readResume(viewer):null;
    const saved = readPosition(entry) || (cold?.path===location.pathname?cold:undefined);
    coldResume.current=false;
    let restoring = !!saved;
    const finish = startJourney('navigation-content');
    const cleanup = restoreScroll(saved || {viewer,path:location.pathname,top:0,feedLimit:10,at:Date.now()});
    const capture = (event?: Event) => {
      const container = (document.querySelector<HTMLElement>('[data-settings-scroll]') || document.querySelector<HTMLElement>('[data-app-scroll]'));
      if (!container || latest.current.entry !== entry) return;
      if (event?.type === 'scroll' && event.target !== container) return;
      if (restoring && event?.type === 'scroll' && Math.abs(container.scrollTop - saved!.top) > 8) return;
      if (restoring && Math.abs(container.scrollTop - saved!.top) <= 8) { restoring=false; finish(); }
      capturePosition(entry,location.pathname,container);
    };
    const interacting = () => { restoring=false; capture(); };
    document.addEventListener('scroll',capture,{capture:true,passive:true});
    document.addEventListener('pointerdown',interacting,true);
    document.addEventListener('keydown',interacting,true);
    return () => { cleanup(); document.removeEventListener('scroll',capture,true);
      document.removeEventListener('pointerdown',interacting,true); document.removeEventListener('keydown',interacting,true); };
  },[entry,viewer,enabled]);
}
