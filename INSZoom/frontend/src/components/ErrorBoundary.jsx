import { Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    // Log so the real error is visible in the console instead of a blank screen
    console.error('Unhandled UI error:', error, errorInfo)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-lg p-8 text-center">
            <h1 className="text-xl font-semibold text-gray-900 mb-2">
              Something went wrong
            </h1>
            <p className="text-gray-600 mb-4">
              The page failed to render. Try reloading — if it keeps happening,
              the error below will help us debug it.
            </p>
            <pre className="text-left text-xs bg-gray-100 text-red-600 rounded-lg p-3 mb-4 overflow-auto max-h-40">
              {this.state.error?.message || String(this.state.error)}
            </pre>
            <button onClick={this.handleReload} className="btn-primary">
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
