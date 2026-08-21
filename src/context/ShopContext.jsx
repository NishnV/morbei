import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useCustomer } from '../hooks/useCustomer';

const ShopContext = createContext();

const WISHLIST_KEY = 'morbei_wishlist';

/**
 * Read the stored wishlist, but only if it belongs to the current viewer.
 *
 * The list used to be a bare array with no notion of who saved it, and nothing
 * removed it on sign-out. Signing out and signing in as someone else therefore
 * showed the previous customer's wishlist — and worse, the login sync pushed
 * those items into the new account's server-side list, so one person's saved
 * products permanently became another's.
 *
 * `owner: null` is a genuine guest list and is meant to merge into whoever
 * signs in next; that is the feature. A list owned by a different customer is
 * ignored. A bare array is from before this was scoped: trusted only when
 * nobody is signed in, because there is no way to tell whose it is, and the
 * signed-in case is covered by the server list anyway.
 */
function readStoredWishlist(ownerId) {
    try {
        const raw = JSON.parse(localStorage.getItem(WISHLIST_KEY) || 'null');
        if (Array.isArray(raw)) return ownerId ? [] : raw;
        if (!raw || typeof raw !== 'object') return [];
        if (raw.owner == null) return raw.items || [];
        return raw.owner === ownerId ? (raw.items || []) : [];
    } catch {
        return [];
    }
}

function writeStoredWishlist(ownerId, items) {
    try {
        localStorage.setItem(WISHLIST_KEY, JSON.stringify({ owner: ownerId, items }));
    } catch { /* quota or private mode — the in-memory list still works */ }
}

export const ShopProvider = ({ children }) => {
    const { customer } = useCustomer();
    const customerId = customer?.id || null;

    const [wishlist, setWishlist] = useState(() => readStoredWishlist(null));
    const [isCartOpen, setIsCartOpen] = useState(false);

    // Sign-out empties the list during render rather than in an effect, so
    // there is no commit in which the previous customer's items are still in
    // state while `customerId` has already gone null — that window is exactly
    // where they would be persisted under `owner: null` and then merged into
    // the next account to sign in. The persist effect below writes the empty
    // list immediately after.
    const [listOwner, setListOwner] = useState(null);
    if (listOwner !== customerId) {
        setListOwner(customerId);
        if (!customerId) setWishlist([]);
    }

    // Persist on every change, always stamped with the owner.
    useEffect(() => {
        writeStoredWishlist(customerId, wishlist);
    }, [wishlist, customerId]);

    // Merge the guest list into the account and adopt the server's copy.
    // This used to run only on mount, so signing in without a page reload —
    // the normal path in a single-page app — never synced at all.
    // Depending on customerId alone is what makes this run exactly once per
    // account: on mount there is no customer to sync with, and it fires again
    // only when a different one signs in.
    useEffect(() => {
        if (!customerId) return;

        const local = readStoredWishlist(customerId);
        apiFetch('/wishlist/sync', {
            method: 'POST',
            body: JSON.stringify({
                items: local.map(p => ({
                    product_id: String(p.id ?? p.product_id),
                    variant_id: p.variant_id || null,
                    product_data: p,
                })),
            }),
        })
            .then(data => { if (data.wishlist) setWishlist(data.wishlist); })
            .catch(() => { /* offline — the local list stands until next time */ });
    }, [customerId]);


    const toggleWishlist = useCallback((product) => {
        const productId = String(product.id);

        setWishlist(prev => {
            const exists = prev.find(item => String(item.id) === productId || item.product_id === productId);
            if (exists) {
                if (customerId) apiFetch(`/wishlist/${productId}`, { method: 'DELETE' }).catch(() => {});
                return prev.filter(item => String(item.id) !== productId && item.product_id !== productId);
            }
            const normalized = {
                ...product,
                img: product.img || product.images?.[0] || '/placeholder.png',
                product_id: productId,
            };
            if (customerId) {
                apiFetch('/wishlist', {
                    method: 'POST',
                    body: JSON.stringify({
                        product_id: productId,
                        variant_id: product.variant_id || null,
                        product_data: normalized,
                    }),
                }).catch(() => {});
            }
            return [...prev, normalized];
        });
    }, [customerId]);

    const isInWishlist = useCallback(
        (productId) => wishlist.some(item => String(item.id) === String(productId) || item.product_id === String(productId)),
        [wishlist]
    );

    return (
        <ShopContext.Provider value={{
            wishlist,
            toggleWishlist,
            isInWishlist,
            isCartOpen,
            setIsCartOpen,
        }}>
            {children}
        </ShopContext.Provider>
    );
};

export const useShop = () => useContext(ShopContext);
