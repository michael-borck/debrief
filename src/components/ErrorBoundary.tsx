import React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, errorInfo: null };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary] Renderer crash:', error, errorInfo);
  }

  handleReload = (): void => {
    window.location.reload();
  };

  handleCopy = async (): Promise<void> => {
    const { error, errorInfo } = this.state;
    if (!error) return;
    const payload = [
      `${error.name}: ${error.message}`,
      '',
      error.stack || '(no stack)',
      '',
      '--- component stack ---',
      errorInfo?.componentStack || '(no component stack)',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Clipboard may be unavailable; user can still see the text on screen.
    }
  };

  render(): React.ReactNode {
    const { error, errorInfo } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center p-6">
        <div className="max-w-2xl w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8">
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-gray-100 mb-2">
            Something went wrong
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            Deep-Talk hit an unexpected error and couldn't render this view. Your data is safe — reloading should restore the app.
          </p>

          <div className="bg-gray-100 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded p-4 mb-4">
            <div className="font-mono text-sm text-red-600 dark:text-red-400 mb-2">
              {error.name}: {error.message}
            </div>
            {error.stack && (
              <pre className="font-mono text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap overflow-x-auto max-h-48">
                {error.stack}
              </pre>
            )}
            {errorInfo?.componentStack && (
              <pre className="font-mono text-xs text-gray-500 dark:text-gray-500 whitespace-pre-wrap overflow-x-auto max-h-32 mt-2 border-t border-gray-200 dark:border-gray-700 pt-2">
                {errorInfo.componentStack}
              </pre>
            )}
          </div>

          <div className="flex gap-3">
            <button
              onClick={this.handleReload}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded font-medium"
            >
              Reload app
            </button>
            <button
              onClick={this.handleCopy}
              className="px-4 py-2 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-900 dark:text-gray-100 rounded font-medium"
            >
              Copy error details
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
