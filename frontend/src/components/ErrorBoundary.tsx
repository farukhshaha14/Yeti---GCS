import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('VEGAPilot GCS ErrorBoundary caught an unhandled error:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[300px] flex items-center justify-center p-6 bg-slate-900 border border-red-500/30 rounded-lg text-slate-200 font-mono">
          <div className="max-w-xl w-full text-center space-y-4">
            <div className="inline-flex p-3 bg-red-500/10 border border-red-500/30 rounded-full text-red-400">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div className="space-y-1">
              <h2 className="text-base font-bold text-red-300">
                {this.props.fallbackTitle || 'VEGAPilot Interface Fault Detected'}
              </h2>
              <p className="text-xs text-slate-400">
                A component runtime exception occurred. The GCS backend and flight telemetry continue safely in the background.
              </p>
            </div>

            {this.state.error && (
              <div className="p-3 bg-slate-950 rounded border border-slate-800 text-left text-[11px] text-red-400 max-h-36 overflow-y-auto">
                <div className="font-bold mb-1">{this.state.error.name}: {this.state.error.message}</div>
                {this.state.errorInfo?.componentStack && (
                  <pre className="text-[10px] text-slate-500 whitespace-pre-wrap">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </div>
            )}

            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/30 rounded text-xs font-bold inline-flex items-center gap-2 transition"
            >
              <RotateCcw className="w-4 h-4" /> Reset Interface & Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
