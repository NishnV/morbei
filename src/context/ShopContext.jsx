import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

const ShopContext = createContext();

const WISHLIST_KEY = 'morbei_wishlist';

function getLocalWishlist() {
    try { return JSON.parse(localStorage.getItem(WISHLIST_KEY) || '[]'); } catch { return []; }
}

export const ShopProvider = ({ children }) => {
    const [wishlist, setWishlist] = useState(getLocalWishlist);
    const [isCartOpen, setIsCartOpen] = useState(false);

    // Persist wishlist locally on every change
    useEffect(() => {
        localStorage.setItem(WISHLIST_KEY, JSON.stringify(wishlist));
    }, [wishlist]);

    // On mount: if user is logged in, merge local wishlist with server wishlist
    useEffect(() => {
        const token = localStorage.getItem('morbei_token');
        if (!token) return;

        const local = getLocalWishlist();
        const syncPayload = local.map(p => ({
            product_id: String(p.id),
            variant_id: p.variant_id || null,
            product_data: p,
        }));

        apiFetch('/wishlist/sync', {
            method: 'POST',
            body: JSON.stringify({ items: syncPayload }),
        })
            .then(data => {
                if (data.wishlist) setWishlist(data.wishlist);
            })
            .catch(() => {}); // silently ignore if not logged in
    }, []);

    const toggleWishlist = useCallback((product) => {
        const productId = String(product.id);
        const token = localStorage.getItem('morbei_token');

        setWishlist(prev => {
            const exists = prev.find(item => String(item.id) === productId || item.product_id === productId);
            if (exists) {
                if (token) apiFetch(`/wishlist/${productId}`, { method: 'DELETE' }).catch(() => {});
                return prev.filter(item => String(item.id) !== productId && item.product_id !== productId);
            }
            const normalized = {
                ...product,
                img: product.img || product.images?.[0] || '/placeholder.png',
                product_id: productId,
            };
            if (token) {
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
    }, []);

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

