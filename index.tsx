import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import App from './App';
import { registerSW } from 'virtual:pwa-register';
import { registerPwa } from './utils/pwaRegistration';
import './i18n';
import './styles/theme.css';
import { installSheetHistory } from './utils/sheetHistory';

// Update the worker in the background. Never reload an active page: doing so can
// abort an in-flight media upload/finalization. The new worker controls the next
// navigation without interrupting the current user action.
registerPwa(registerSW);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
installSheetHistory();
const router = createBrowserRouter([{ path: '*', element: <App /> }]);
root.render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>
);
