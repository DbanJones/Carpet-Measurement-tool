import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/workspace.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

/**
 * Register the offline shell (see public/sw.js). The app is installable and is used in empty houses
 * with no signal, so it has to open without a network. Production only: in dev the service worker
 * would serve stale modules back to Vite's HMR.
 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    // `import.meta.env.BASE_URL` keeps the scope right when the site is hosted in a sub-folder.
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {
      /* offline support is a bonus: a browser that refuses it still runs the app */
    });
  });
}
