import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import ReferenceExtractor from './dtw/ReferenceExtractor';
import ValidationPage from './dtw/ValidationPage';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import ErrorBoundary, { notifyHostOfError } from './ErrorBoundary';

// Async failures (rejected promises in the detection loop, model loads) never reach
// the React error boundary, so surface them to the host rather than losing them
// in a console the patient will never open.
window.addEventListener('unhandledrejection', (e) => {
  console.error('[Global] Unhandled promise rejection:', e.reason);
  notifyHostOfError('An unexpected error occurred.', e.reason?.message || e.reason);
});

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
