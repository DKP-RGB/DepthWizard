import { useStore } from './store';
import Landing from './components/Landing';
import Processing from './components/Processing';
import Dashboard from './components/Dashboard';
import './index.css';

import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ color: 'red', padding: '20px', background: '#fff', zIndex: 9999, position: 'relative' }}>
          <h2>Something went wrong.</h2>
          <pre>{this.state.error?.toString()}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {
  const { appState } = useStore();

  return (
    <ErrorBoundary>
      <div className="app-container">
        {appState === 'LANDING' && <Landing />}
        {appState === 'PROCESSING' && <Processing />}
        {appState === 'DASHBOARD' && <Dashboard />}
      </div>
    </ErrorBoundary>
  );
}

export default App;
