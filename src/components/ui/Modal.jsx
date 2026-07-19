import React, { useEffect, useState } from 'react';
import './Modal.css';

/**
 * Minimal site-styled dialog — replaces browser confirm/alert/prompt.
 *
 * Modes (composable via props):
 * - notice:  title + message + confirm button
 * - confirm: add cancelLabel for a two-action dialog
 * - prompt:  set `input` for a single text/email field; `validate(value)`
 *            returns an error string to block submission, or null to allow.
 */
const Modal = ({
    open,
    title,
    message,
    input = false,
    inputType = 'text',
    inputPlaceholder = '',
    validate,
    confirmLabel = 'CONFIRM',
    cancelLabel,
    onConfirm,
    onClose,
}) => {
    const [value, setValue] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (open) {
            setValue('');
            setError('');
        }
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    const submit = (e) => {
        e.preventDefault();
        if (validate) {
            const err = validate(value);
            if (err) {
                setError(err);
                return;
            }
        }
        onConfirm?.(value);
    };

    return (
        <div className="morbei-modal-backdrop" onClick={onClose}>
            <div
                className="morbei-modal"
                role="dialog"
                aria-modal="true"
                onClick={(e) => e.stopPropagation()}
            >
                {title && <h3 className="morbei-modal-title">{title}</h3>}
                {message && <p className="morbei-modal-message">{message}</p>}
                <form onSubmit={submit} noValidate>
                    {input && (
                        <input
                            className="morbei-modal-input"
                            type={inputType}
                            placeholder={inputPlaceholder}
                            value={value}
                            onChange={(e) => { setValue(e.target.value); setError(''); }}
                            autoFocus
                        />
                    )}
                    {error && <p className="morbei-modal-error">{error}</p>}
                    <div className="morbei-modal-actions">
                        <button type="submit" className="morbei-modal-confirm">{confirmLabel}</button>
                        {cancelLabel && (
                            <button type="button" className="morbei-modal-cancel" onClick={onClose}>
                                {cancelLabel}
                            </button>
                        )}
                    </div>
                </form>
            </div>
        </div>
    );
};

export default Modal;
