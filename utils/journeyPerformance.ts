/** Local bounded User Timing only. No user identifiers, content or telemetry uploads. */
let sequence = 0;
export function startJourney(name: string) {
  const started = typeof performance !== 'undefined' ? performance.now() : 0;
  let finished = false;
  return (outcome: 'ready' | 'failed' | 'cancelled' = 'ready') => {
    if (finished || typeof performance === 'undefined') return;
    finished = true;
    const measure = 'opiniup:' + name + ':' + outcome;
    performance.measure(measure, { start: started, end: performance.now() });
    if (++sequence % 100 === 0) for (const entry of performance.getEntriesByType('measure')) {
      if (entry.name.startsWith('opiniup:')) performance.clearMeasures(entry.name);
    }
  };
}
