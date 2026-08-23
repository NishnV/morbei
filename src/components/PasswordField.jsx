import React, { useState } from 'react';

/**
 * Password input with a show/hide toggle.
 *
 * Renders its own `.profile-auth-input-group` wrapper — that class is already
 * `position: relative`, which is what lets the toggle pin to the right edge
 * without disturbing the underline the group draws.
 *
 * Shared by the login/signup forms and the password reset page, so the eye
 * behaves identically everywhere.
 */
const PasswordField = ({
    name = 'password',
    value,
    onChange,
    placeholder = 'PASSWORD',
    autoComplete = 'current-password',
    required = true,
    minLength,
}) => {
    const [visible, setVisible] = useState(false);

    return (
        <div className="profile-auth-input-group">
            <input
                name={name}
                type={visible ? 'text' : 'password'}
                placeholder={placeholder}
                value={value}
                onChange={onChange}
                className="profile-auth-input profile-auth-input--password"
                autoComplete={autoComplete}
                required={required}
                minLength={minLength}
            />
            <button
                type="button"
                className="profile-auth-eye"
                // Keep focus in the field: without this the mousedown blurs the
                // input and the caret jumps to the end of the password.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setVisible((v) => !v)}
                aria-label={visible ? 'Hide password' : 'Show password'}
                aria-pressed={visible}
                title={visible ? 'Hide password' : 'Show password'}
            >
                {visible ? (
                    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M2 10s2.9-5.2 8-5.2 8 5.2 8 5.2-2.9 5.2-8 5.2S2 10 2 10Z" stroke="currentColor" strokeWidth="1.1" />
                        <circle cx="10" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.1" />
                        <path d="M3.5 16.5 16.5 3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                    </svg>
                ) : (
                    <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                        <path d="M2 10s2.9-5.2 8-5.2 8 5.2 8 5.2-2.9 5.2-8 5.2S2 10 2 10Z" stroke="currentColor" strokeWidth="1.1" />
                        <circle cx="10" cy="10" r="2.3" stroke="currentColor" strokeWidth="1.1" />
                    </svg>
                )}
            </button>
        </div>
    );
};

export default PasswordField;
