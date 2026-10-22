import { Component, ErrorInfo, ReactNode } from 'react';
import { ShieldAlert } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Catches render/lifecycle errors thrown by any descendant component so the
 * whole application never crashes into a blank screen.
 *
 * Recovery uses local state reset (re-render children) — it never forces a full
 * page reload, so it cannot loop infinitely. If the same error re-occurs while
 * rendering children, the boundary simply shows the fallback again.
 *
 * Technical details are only logged to the console in development; end users
 * see a generic, safe message with a recovery action.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('[ErrorBoundary] Recovered from error:', error, errorInfo);
    } else {
      // Production: log a minimal identifier only — never full stacks or user data.
      console.error('[ErrorBoundary] Recovered from error:', error?.message || 'Unknown error');
    }
  }

  private handleTryAgain = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="app-shell">
        <main
          className="main-content"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '60vh',
          }}
        >
          <div className="section-container" style={{ width: '100%' }}>
            <div className="state-panel">
              <div className="state-panel-icon">
                <ShieldAlert className="w-7 h-7" />
              </div>
              <h3>Something went wrong</h3>
              <p>
                An unexpected issue interrupted this view. Your travel plans and saved data are
                safe. Please try again — if the problem persists, refresh the page.
              </p>
              <button
                type="button"
                onClick={this.handleTryAgain}
                className="btn-primary py-3.5 px-8"
                style={{ padding: '0.9rem 2rem' }}
              >
                Try Again
              </button>
            </div>
          </div>
        </main>
      </div>
    );
  }
}
