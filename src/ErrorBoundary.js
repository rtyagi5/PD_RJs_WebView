// ---------------------------------------------
// ErrorBoundary.js
// Catches render/lifecycle crashes anywhere below it so a patient never sees a
// blank white screen mid-session, and notifies the host app so the session can
// be ended or retried on its side.
// ---------------------------------------------
import React from 'react';

/** Tell the host app something went wrong (best effort — never throws). */
export function notifyHostOfError(message, detail) {
  const payload = {
    type: 'error',
    error: message,
    detail: detail ? String(detail).slice(0, 500) : undefined,
    completionStatusRef: false,
  };
  try {
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
    } else if (window.parent) {
      window.parent.postMessage(payload, '*');
    }
  } catch {
    /* the bridge itself failing must not mask the original error */
  }
}

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] Unhandled error:', error, info?.componentStack);
    notifyHostOfError('Something went wrong during the exercise.', error?.message);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div style={styles.wrap} role="alert">
        <div style={styles.title}>Something went wrong</div>
        <div style={styles.body}>
          The exercise had to stop. Please close this screen and try again.
        </div>
        <button style={styles.button} onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
}

const styles = {
  wrap: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', minHeight: '100vh', padding: 24,
    textAlign: 'center', background: '#111', color: '#fff',
    fontFamily: 'system-ui, sans-serif',
  },
  title: { fontSize: 20, fontWeight: 600, marginBottom: 8 },
  body: { fontSize: 15, opacity: 0.8, marginBottom: 20, maxWidth: 320 },
  button: {
    padding: '10px 24px', fontSize: 15, borderRadius: 8,
    border: 'none', background: '#66FF00', color: '#111',
    fontWeight: 600, cursor: 'pointer',
  },
};

export default ErrorBoundary;
