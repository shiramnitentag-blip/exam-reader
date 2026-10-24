import { Component, StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/noto-sans-hebrew/hebrew-400.css';
import '@fontsource/noto-sans-hebrew/hebrew-700.css';
import '@fontsource/noto-sans-hebrew/latin-400.css';
import '@fontsource/noto-sans-hebrew/latin-700.css';
import './styles.css';
import App from './App';
import { startUpdates } from './update';

// If something breaks, show a message instead of an empty screen.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="boot-msg">
        <p>מַשֶּׁהוּ הִשְׁתַּבֵּשׁ. נַסִּי לִסְגֹּר וְלִפְתֹּחַ שׁוּב.</p>
        <button className="btn" onClick={() => location.reload()}>
          לִפְתֹּחַ שׁוּב
        </button>
        <pre className="boot-detail">{String(this.state.error?.message || this.state.error)}</pre>
      </div>
    );
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
(window as Window & { __appStarted?: boolean }).__appStarted = true;
startUpdates();
