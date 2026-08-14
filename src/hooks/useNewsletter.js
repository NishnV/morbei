import { useState, useCallback } from 'react';
import { contactAPI } from '../lib/api';

/**
 * Newsletter subscription with honest result states.
 *
 * The footer form used to swallow every error and show "THANK YOU FOR
 * SUBSCRIBING!" unconditionally — network down, rate limited, server 500, the
 * user was told it worked. Signups were being lost with no signal.
 *
 * Shared by the footer and any other entry point (exit-intent modal, checkout
 * opt-in) so they can't drift apart.
 */

const STORAGE_KEY = 'morbei_newsletter';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function useNewsletter(source = 'footer') {
    const [status, setStatus] = useState('idle'); // idle | loading | success | already | error
    const [message, setMessage] = useState('');

    const subscribe = useCallback(async (rawEmail) => {
        const email = String(rawEmail || '').trim();
        if (!EMAIL_RE.test(email)) {
            setStatus('error');
            setMessage('PLEASE ENTER A VALID EMAIL');
            return false;
        }

        setStatus('loading');
        try {
            const res = await contactAPI.newsletter(email, source);
            // Remember locally so we stop prompting someone who already signed up.
            try { localStorage.setItem(STORAGE_KEY, 'subscribed'); } catch { /* private mode */ }
            setStatus(res.alreadySubscribed ? 'already' : 'success');
            setMessage(res.alreadySubscribed
                ? "YOU'RE ALREADY ON THE LIST"
                : 'THANK YOU — CHECK YOUR INBOX');
            return true;
        } catch (err) {
            setStatus('error');
            setMessage(
                err.status === 429 || err.message?.includes('Too many')
                    ? 'TOO MANY ATTEMPTS — PLEASE TRY AGAIN LATER'
                    : err.status === 400
                        ? 'PLEASE ENTER A VALID EMAIL'
                        : "COULDN'T SUBSCRIBE — PLEASE TRY AGAIN"
            );
            return false;
        }
    }, [source]);

    const reset = useCallback(() => {
        setStatus('idle');
        setMessage('');
    }, []);

    return { subscribe, reset, status, message, isSubscribed };
}

/** Whether this browser has already completed a subscription. */
export function isSubscribed() {
    try { return localStorage.getItem(STORAGE_KEY) === 'subscribed'; } catch { return false; }
}
