import React from 'react';

class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }

    componentDidCatch(error, info) {
        console.error('ErrorBoundary caught:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{
                    minHeight: '60vh',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '4rem 2rem',
                    textAlign: 'center',
                }}>
                    <p style={{ fontSize: '0.75rem', letterSpacing: '0.25em', color: '#aaa', marginBottom: '1.5rem' }}>
                        SOMETHING WENT WRONG
                    </p>
                    <p style={{ fontSize: '0.7rem', letterSpacing: '0.1em', color: '#666', marginBottom: '2rem' }}>
                        {this.state.error?.message || 'An unexpected error occurred.'}
                    </p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{
                            fontSize: '0.7rem',
                            letterSpacing: '0.2em',
                            padding: '10px 24px',
                            background: '#1a1a1a',
                            color: '#fff',
                            border: 'none',
                            cursor: 'pointer',
                        }}
                    >
                        TRY AGAIN
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
