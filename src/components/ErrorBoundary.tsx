import { Component, type ErrorInfo, type ReactNode } from 'react';

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-6">
          <div className="max-w-md space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6 text-center">
            <h1 className="text-lg font-semibold text-zinc-100">Something went wrong</h1>
            <p className="text-sm text-zinc-400">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <button
              type="button"
              onClick={this.handleReset}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 transition"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="ml-2 rounded-md border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-800 transition"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
