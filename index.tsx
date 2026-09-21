import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { registerSW } from 'virtual:pwa-register';
import './i18n';
import './styles/tailwind.css';

// Auto-update registration handles replacement workers; first installation stays on this page.
registerSW({ 
  immediate: true,
  onOfflineReady() {
    console.log('App ready to work offline');
  }
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
const router = createBrowserRouter([{ path: '*', element: <App /> }]);
root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
