import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Human label for the region this boundary protects, e.g. "Clinician view". */
  label?: string;
  /** Optional custom fallback renderer. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Component-level error boundary. A render error in ONE panel (e.g. a null
 * `toFixed` in a clinician sub-panel) must NEVER blank the whole app — it is
 * contained here and replaced with an inline, recoverable fallback so the rest
 * of the report and the view toggle keep working.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface for diagnostics without crashing the tree.
    // eslint-disable-next-line no-console
    console.error(
      `[ErrorBoundary${this.props.label ? ` · ${this.props.label}` : ""}]`,
      error,
      info?.componentStack,
    );
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (error) {
      if (this.props.fallback) return this.props.fallback(error, this.reset);
      return (
        <div
          role="alert"
          data-testid="error-boundary-fallback"
          className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-6 text-center"
        >
          <h3 className="text-sm font-semibold text-amber-500">
            {this.props.label ?? "This section"} couldn&apos;t be displayed
          </h3>
          <p className="mt-2 text-xs text-muted-foreground leading-relaxed max-w-md mx-auto">
            A display error occurred while rendering this panel. The rest of the
            report is unaffected. This does not change any clinical result.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 rounded-lg border border-border/50 px-4 py-1.5 text-xs font-medium hover:bg-white/[0.04] transition-colors"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
