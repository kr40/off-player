import { Component, type ErrorInfo, type ReactNode } from "react";

/** Last line of defence: a crash shows a way back instead of a blank window. */
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("UI crashed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <div className="crash-card">
          <h2>Something went wrong</h2>
          <p>The screen hit an error. Your library and watch history are safe.</p>
          <pre>{this.state.error.message}</pre>
          <button className="btn primary" onClick={() => location.reload()}>Reload</button>
        </div>
      </div>
    );
  }
}
