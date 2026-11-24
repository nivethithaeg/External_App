import { Component, type ErrorInfo, type ReactNode } from 'react';
import { reportBrowserError } from '../lib/reportError';

/** Catches rendering crashes so a bad response on one page shows a message and a way out, instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('[page crashed]', error, info.componentStack); reportBrowserError(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="mx-auto my-16 max-w-lg rounded-2xl border border-danger/40 bg-surface p-8 text-center">
        <div className="text-4xl" aria-hidden="true">⚠️</div>
        <h1 className="mt-2 text-3xl font-extrabold">This page couldn't be shown</h1>
        <p className="mt-2 text-sm text-muted">Something unexpected happened while loading it. Reloading usually fixes it. If it keeps happening, tell support what you clicked and include this message:</p>
        <p className="mt-3 break-words rounded-xl bg-surface2 p-3 text-left font-mono text-xs">{this.state.error.message}</p>
        <div className="mt-5 flex justify-center gap-2"><button className="btn-primary" onClick={() => window.location.reload()}>Reload page</button><a className="btn-ghost" href="/">Go home</a></div>
      </div>
    );
  }
}
