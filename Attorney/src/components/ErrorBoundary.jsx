import { Component } from 'react'

// A rendering error on one page shows a message here instead of blanking the whole portal. It clears itself
// when `resetKey` changes (the route), so moving to another page recovers without a reload.
export default class ErrorBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    console.error('Page failed to render:', error)
  }

  componentDidUpdate(prevProps) {
    if (this.state.failed && prevProps.resetKey !== this.props.resetKey) this.setState({ failed: false })
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="card text-center py-10">
        <h1 className="text-lg font-bold text-foreground font-serif mb-1">Something went wrong on this page</h1>
        <p className="text-sm text-muted-foreground mb-4">The rest of the portal is still working. Try again, or open another page from the menu.</p>
        <button type="button" onClick={() => this.setState({ failed: false })} className="btn-secondary">Try again</button>
      </div>
    )
  }
}
