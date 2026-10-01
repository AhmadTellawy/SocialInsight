import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import App from './App';
import { useAppNavigation } from './hooks/useAppNavigation';
import { canonicalPath, isKnownPath } from './utils/navigation';
import { registerSW } from 'virtual:pwa-register';
import './i18n';
import './styles/theme.css';
import './styles/tailwind.css';

// Register the PWA service worker
registerSW({ 
  immediate: true,
  onNeedRefresh() {
    window.location.reload();
  },
  onOfflineReady() {
    console.log('App ready to work offline');
  }
});

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const NotFoundScreen = () => {
  const { back } = useAppNavigation();
  const { t } = useTranslation();

  return (
    <main className="min-h-screen bg-gray-100/50 flex items-center justify-center px-6">
      <section className="w-full max-w-md rounded-3xl bg-white px-8 py-12 text-center shadow-xl">
        <h1 className="text-2xl font-black text-gray-900">
          {t('navigation.notFound', { defaultValue: 'Page not found' })}
        </h1>
        <button
          type="button"
          onClick={() => back('/')}
          className="mt-8 min-h-11 rounded-full bg-gray-900 px-6 py-3 text-sm font-bold text-white"
        >
          {t('common.back', { defaultValue: 'Back' })}
        </button>
      </section>
    </main>
  );
};

/** Reject raw unknown paths before App can render or start its data effects. */
const NavigationBoundary = () => {
  const location = useLocation();
  const pathname = canonicalPath(location.pathname);

  if (pathname !== location.pathname) {
    return <Navigate replace to={{ pathname, search: location.search, hash: location.hash }} />;
  }
  if (!isKnownPath(pathname)) return <NotFoundScreen />;
  return <App />;
};

const root = ReactDOM.createRoot(rootElement);
const router = createBrowserRouter([{ path: '*', element: <NavigationBoundary /> }]);
root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
