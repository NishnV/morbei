import React from 'react';
import { Link } from 'react-router-dom';

const NotFound = () => (
    <div style={{
        minHeight: '70vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '4rem 2rem',
        textAlign: 'center',
    }}>
        <p style={{ fontSize: '0.8rem', letterSpacing: '0.4em', color: '#888', marginBottom: '1rem' }}>404</p>
        <h1 style={{ fontSize: '1.1rem', letterSpacing: '0.25em', fontWeight: 500, marginBottom: '2.5rem' }}>
            PAGE NOT FOUND
        </h1>
        <Link
            to="/shop/all"
            style={{
                fontSize: '0.7rem',
                letterSpacing: '0.25em',
                padding: '12px 32px',
                background: '#1a1a1a',
                color: '#fff',
                textDecoration: 'none',
            }}
        >
            CONTINUE SHOPPING
        </Link>
    </div>
);

export default NotFound;
