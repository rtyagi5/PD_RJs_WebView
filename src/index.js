import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ReferenceExtractor from './dtw/ReferenceExtractor';
import ValidationPage from './dtw/ValidationPage';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ErrorBoundary, { notifyHostOfError } from './ErrorBoundary';
import * as serviceWorker from './serviceWorker';

// Async failures (rejected promises in the detection loop, model loads) never reach
// the React error boundary, so surface them to the host rather than losing them
// in a console the patient will never open.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Global] Unhandled promise rejection:', e.reason);
  notifyHostOfError('An unexpected error occurred.', e.reason?.message || e.reason);
});

/**
 * Offer a reload when a new build is waiting, rather than swapping the app out
 * from under someone mid-exercise. Plain DOM because this fires outside the
 * React tree, and the page must not depend on React having mounted.
 */
function showUpdatePrompt(registration) {
  if (document.getElementById('sw-update-banner')) return;
  const bar = document.createElement('div');
  bar.id = 'sw-update-banner';
  bar.setAttribute('role', 'status');
  bar.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;display:flex;' +
    'gap:12px;align-items:center;justify-content:center;padding:12px 16px;' +
    'background:#0F172A;color:#fff;font:500 14px/1.4 system-ui,sans-serif';
  const msg = document.createElement('span');
  msg.textContent = 'A new version is available.';
  const btn = document.createElement('button');
  btn.textContent = 'Reload';
  btn.style.cssText =
    'padding:6px 14px;border:0;border-radius:15px;background:#1B6CB6;color:#fff;' +
    'font:500 14px system-ui,sans-serif;cursor:pointer';
  btn.onclick = () => {
    if (registration.waiting) registration.waiting.postMessage({ type: 'SKIP_WAITING' });
    window.location.reload();
  };
  bar.append(msg, btn);
  document.body.appendChild(bar);
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <ErrorBoundary>
      <Router>
        <Routes>
          <Route path="/reference-extractor" element={<ReferenceExtractor />} />
          <Route path="/dtw-validation" element={<ValidationPage />} />
          <Route path="*" element={<App />} />
        </Routes>
      </Router>
    </ErrorBoundary>
);

// Offline support. register() is a no-op unless NODE_ENV === 'production'.
//
// The explicit unregister() in development is not redundant: serving a
// production build on localhost:3000 to test it on the phone leaves a worker
// registered on that origin, and it would then intercept `yarn start` and serve
// a stale bundle over adb reverse — silently breaking the live-test loop. This
// actively clears it.
if (process.env.NODE_ENV === 'production') {
  serviceWorker.register({ onUpdate: showUpdatePrompt });
} else {
  serviceWorker.unregister();
}
