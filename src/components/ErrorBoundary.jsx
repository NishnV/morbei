import React from 'react';
import { isChunkLoadError, reloadForChunkError } from '../lib/chunkReload';

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
        // A stale chunk is not an application fault and there is nothing to
        // show the shopper about it — reload straight into the current build.
        // reloadForChunkError returns false if it already tried, which means
        // reloading did not help; fall through to the message rather than loop.
        if (isChunkLoadError(error)) reloadForChunkError();
    }

    render() {
        if (this.state.hasError) {
            const stale = isChunkLoadError(this.state.error);
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
                        {stale
                            // The raw message names a filename and a hash. It tells a
                            // shopper nothing and reads like a broken site.
                            ? 'THE SITE WAS UPDATED. RELOAD TO CONTINUE.'
                            : (this.state.error?.message || 'An unexpected error occurred.')}
                    </p>
                    <button
                        onClick={() => {
                            // Clearing state cannot fix a stale chunk: React.lazy holds
                            // on to the rejected promise, so the retry never even asks
                            // for the file again.
                            if (stale) window.location.reload();
                            else this.setState({ hasError: false, error: null });
                        }}
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
                        {stale ? 'RELOAD' : 'TRY AGAIN'}
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

export default ErrorBoundary;
