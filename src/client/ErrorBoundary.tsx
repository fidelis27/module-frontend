import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  appName: string;
  name: string;
  onError?: (error: Error, info?: ErrorInfo) => void;
  fallback?: ReactNode;
  children?: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.props.onError?.(error, info);
  }

  render() {
    if (this.state.error) {
      return this.props.fallback ?? null;
    }
    return this.props.children;
  }
}
