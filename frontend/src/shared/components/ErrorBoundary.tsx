import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@/shared/ui/Button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Top-level boundary so a render error in any page shows a recoverable screen
 * instead of white-screening the whole app.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surfaced to the user below; logged for diagnostics.
    console.error('Unhandled UI error:', error, info.componentStack)
  }

  handleReset = () => {
    this.setState({ error: null })
    window.location.assign('/')
  }

  render() {
    if (this.state.error) {
      return (
        <div className="grid min-h-screen place-items-center bg-slate-950 p-6 text-center">
          <div className="max-w-md">
            <h1 className="text-xl font-semibold text-slate-100">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-400">
              An unexpected error occurred while rendering this page. You can return to the
              dashboard and try again.
            </p>
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 text-left text-xs text-red-400">
              {this.state.error.message}
            </pre>
            <div className="mt-4 flex justify-center gap-2">
              <Button onClick={this.handleReset}>Back to dashboard</Button>
              <Button variant="ghost" onClick={() => window.location.reload()}>
                Reload
              </Button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
