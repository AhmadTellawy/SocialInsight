type RegisterServiceWorker = (options: {
  immediate: true;
  onOfflineReady: () => void;
}) => unknown;

export const registerPwa = (register: RegisterServiceWorker): unknown => register({
  immediate: true,
  onOfflineReady() {
    console.log('App ready to work offline');
  }
});
