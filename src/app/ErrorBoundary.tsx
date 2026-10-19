import { Component, type ErrorInfo, type ReactNode } from "react";
import { devLog } from "../lib/devLogger";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence: a render error shows a recovery screen instead of a blank
 * window. Reloading keeps the user signed in only if their session survives a reload,
 * so the copy doesn't promise otherwise.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    devLog.error(`UI crashed: ${error.message}`, info.componentStack ?? error.stack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="flex h-screen items-center justify-center bg-orbit-base p-6 text-orbit-text">
        <div className="max-w-md rounded-2xl border border-white/10 bg-orbit-panel p-6 text-center shadow-xl">
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm text-orbit-muted">Orbit hit an unexpected error. Reloading usually fixes it.</p>
          <pre className="mt-4 max-h-32 overflow-auto rounded-lg bg-black/30 p-3 text-left font-mono text-[11px] text-rose-300">{this.state.error.message}</pre>
          <div className="mt-5 flex justify-center gap-2">
            <button
              type="button"
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-white/10 bg-white/[0.06] px-3 py-2 text-sm font-semibold hover:bg-white/[0.1]"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-orbit-accent px-3 py-2 text-sm font-bold text-slate-950 hover:brightness-110"
            >
              Reload
            </button>
          </div>
        </div>
      </div>
    );
  }
}
