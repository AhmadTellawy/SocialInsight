type RegisterServiceWorker = (options: {
  immediate: true;
  onOfflineReady: () => void;
}) => unknown;

// `autoUpdate` makes vite-plugin-pwa reload every controlled tab when a new
// worker activates. Keep updates in the waiting state until the tab naturally
// closes so an upload/finalization cannot be interrupted by an implicit reload.
export const PWA_REGISTER_TYPE = 'prompt' as const;

export const registerPwa = (register: RegisterServiceWorker): unknown => register({
  immediate: true,
  onOfflineReady() {
    console.log('App ready to work offline');
  }
});
