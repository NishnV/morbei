/**
 * CartContext — Shopify Storefront API Cart State Management
 *
 * Provides cart state and actions to all components via React Context.
 * Cart ID is persisted in localStorage so it survives page reloads.
 *
 * All mutations go through the Shopify Storefront API.
 * The local state is always derived from the API response.
 */

import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { useCustomer } from '../hooks/useCustomer';
import { shopifyFetch, handleUserErrors } from '../lib/shopify';
import {
  CART_CREATE_MUTATION,
  CART_LINES_ADD_MUTATION,
  CART_LINES_UPDATE_MUTATION,
  CART_LINES_REMOVE_MUTATION,
  CART_DISCOUNT_CODES_UPDATE_MUTATION,
  CART_QUERY,
} from '../graphql/cart';
import { flattenEdges } from '../utils/normalizeProduct';

export const CartContext = createContext(null);

const CART_ID_KEY = 'morbei_shopify_cart_id';

/**
 * Normalize the full cart response from Shopify into a clean shape.
 * Lines are kept in raw Shopify structure so consuming components
 * can access line.merchandise, line.cost, etc. directly.
 */
function normalizeCart(cart) {
  if (!cart) return null;

  const lines = flattenEdges(cart.lines);

  return {
    id: cart.id,
    checkoutUrl: cart.checkoutUrl,
    totalQuantity: cart.totalQuantity,
    lines,
    cost: cart.cost || {},
    discountCodes: cart.discountCodes || [],
    discountAllocations: cart.discountAllocations || [],
    note: cart.note,
    createdAt: cart.createdAt,
    updatedAt: cart.updatedAt,
  };
}

export function CartProvider({ children }) {
  const { customer } = useCustomer();
  const customerId = customer?.id || null;

  const [cart, setCart] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const cartIdRef = useRef(localStorage.getItem(CART_ID_KEY));

  /**
   * Update local cart state and persist the cart ID.
   */
  // Whether any cart response has landed yet. The background retry below must
  // not overwrite a cart that an add-to-bag has refreshed in the meantime.
  const cartLoadedRef = useRef(false);

  const updateCart = useCallback((rawCart) => {
    const normalized = normalizeCart(rawCart);
    cartLoadedRef.current = true;
    setCart(normalized);
    if (normalized?.id) {
      localStorage.setItem(CART_ID_KEY, normalized.id);
      cartIdRef.current = normalized.id;
    }
  }, []);

  /**
   * Fetch the existing cart on mount (if cart ID exists in localStorage).
   */
  useEffect(() => {
    let cancelled = false;
    let retryTimer = null;

    async function loadCart(isRetry = false) {
      const storedId = localStorage.getItem(CART_ID_KEY);
      if (!storedId) {
        setLoading(false);
        return;
      }

      try {
        const data = await shopifyFetch({
          query: CART_QUERY,
          variables: { cartId: storedId },
        });
        if (cancelled) return;

        if (data.cart) {
          if (!isRetry || !cartLoadedRef.current) updateCart(data.cart);
        } else {
          // Shopify answered, and the cart is gone: expired or completed.
          localStorage.removeItem(CART_ID_KEY);
          cartIdRef.current = null;
        }
      } catch {
        // A failed request says nothing about the cart. This used to delete
        // the cart id here, so one dropped request on mobile data emptied a
        // returning shopper's bag for good. Keep the id and look once more;
        // if that fails too the bag is still there on the next page load.
        if (!cancelled && !isRetry) {
          retryTimer = setTimeout(() => loadCart(true), 3000);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadCart();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [updateCart]);

  /**
   * Create a new cart (lazy — created on first add-to-cart if no cart exists).
   */
  const createCart = useCallback(
    async (lines = []) => {
      const data = await shopifyFetch({
        query: CART_CREATE_MUTATION,
        variables: { input: { lines } },
      });

      handleUserErrors(data.cartCreate.userErrors);
      updateCart(data.cartCreate.cart);
      return data.cartCreate.cart;
    },
    [updateCart]
  );

  /**
   * Add an item to the cart by variant ID and quantity.
   *
   * @param {string} variantId - The Shopify product variant GID
   * @param {number} [quantity=1] - Quantity to add
   */
  const addToCart = useCallback(
    async (variantId, quantity = 1) => {
      try {
        setError(null);

        const lineInput = { merchandiseId: variantId, quantity };

        // If no cart exists, create one with the line
        if (!cartIdRef.current) {
          await createCart([lineInput]);
          return;
        }

        const data = await shopifyFetch({
          query: CART_LINES_ADD_MUTATION,
          variables: {
            cartId: cartIdRef.current,
            lines: [lineInput],
          },
        });

        // The stored cart no longer exists in Shopify (they expire). Start a
        // new one with this item rather than failing every add until the
        // shopper clears their browser. Only on Shopify's own "no such cart"
        // answer: a network failure must not replace a bag that has items.
        const result = data.cartLinesAdd;
        const cartGone = !result.cart && (result.userErrors || []).some(
          (e) => (e.field || []).includes('cartId') || /cart/i.test(e.message || '')
        );
        if (cartGone) {
          localStorage.removeItem(CART_ID_KEY);
          cartIdRef.current = null;
          await createCart([lineInput]);
          return;
        }

        handleUserErrors(result.userErrors);
        updateCart(result.cart);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [createCart, updateCart]
  );

  /**
   * Update the quantity of a cart line item.
   *
   * @param {string} lineId - The cart line ID
   * @param {number} quantity - New quantity (0 to remove)
   */
  const updateQuantity = useCallback(
    async (lineId, quantity) => {
      if (!cartIdRef.current) return;

      try {
        setError(null);

        if (quantity <= 0) {
          return removeFromCart(lineId);
        }

        const data = await shopifyFetch({
          query: CART_LINES_UPDATE_MUTATION,
          variables: {
            cartId: cartIdRef.current,
            lines: [{ id: lineId, quantity }],
          },
        });

        handleUserErrors(data.cartLinesUpdate.userErrors);
        updateCart(data.cartLinesUpdate.cart);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [updateCart]
  );

  /**
   * Remove a line item from the cart.
   *
   * @param {string} lineId - The cart line ID to remove
   */
  const removeFromCart = useCallback(
    async (lineId) => {
      if (!cartIdRef.current) return;

      try {
        setError(null);

        const data = await shopifyFetch({
          query: CART_LINES_REMOVE_MUTATION,
          variables: {
            cartId: cartIdRef.current,
            lineIds: [lineId],
          },
        });

        handleUserErrors(data.cartLinesRemove.userErrors);
        updateCart(data.cartLinesRemove.cart);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [updateCart]
  );

  /**
   * Apply a discount code to the cart.
   *
   * @param {string} code - Discount code string
   */
  const applyDiscount = useCallback(
    async (code) => {
      if (!cartIdRef.current) return;

      try {
        setError(null);

        // Collect existing codes and add the new one
        const existingCodes = (cart?.discountCodes || [])
          .filter((dc) => dc.applicable)
          .map((dc) => dc.code);
        const allCodes = [...new Set([...existingCodes, code])];

        const data = await shopifyFetch({
          query: CART_DISCOUNT_CODES_UPDATE_MUTATION,
          variables: {
            cartId: cartIdRef.current,
            discountCodes: allCodes,
          },
        });

        handleUserErrors(data.cartDiscountCodesUpdate.userErrors);
        updateCart(data.cartDiscountCodesUpdate.cart);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [cart, updateCart]
  );

  /**
   * Remove all discount codes from the cart.
   */
  const removeDiscount = useCallback(async () => {
    if (!cartIdRef.current) return;

    try {
      setError(null);

      const data = await shopifyFetch({
        query: CART_DISCOUNT_CODES_UPDATE_MUTATION,
        variables: {
          cartId: cartIdRef.current,
          discountCodes: [],
        },
      });

      handleUserErrors(data.cartDiscountCodesUpdate.userErrors);
      updateCart(data.cartDiscountCodesUpdate.cart);
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [updateCart]);

  /**
   * Clear the cart reference from local state and localStorage.
   * Used after successful checkout to start fresh.
   */
  const clearCart = useCallback(() => {
    localStorage.removeItem(CART_ID_KEY);
    cartIdRef.current = null;
    setCart(null);
  }, []);

  // A Shopify cart is anonymous — it belongs to whoever holds its id, and the
  // id outlived sign-out in localStorage. Signing out and signing in as
  // someone else handed the new customer the previous one's bag, which both
  // leaks what they were buying and is baffling to arrive at checkout with.
  //
  // Only a sign-out clears it: a guest who fills a bag and then signs in must
  // keep it, which is the whole point of a persistent cart. That is why this
  // watches for a customer disappearing rather than simply changing.
  const hadCustomer = useRef(false);
  useEffect(() => {
    if (customerId) {
      hadCustomer.current = true;
      return;
    }
    if (hadCustomer.current) {
      hadCustomer.current = false;
      clearCart();
    }
  }, [customerId, clearCart]);

  const value = {
    cart,
    cartItems: cart?.lines || [],
    cartCount: cart?.totalQuantity || 0,
    subtotal: cart?.cost?.subtotalAmount || { amount: '0', currencyCode: 'INR' },
    total: cart?.cost?.totalAmount || { amount: '0', currencyCode: 'INR' },
    tax: cart?.cost?.totalTaxAmount || { amount: '0', currencyCode: 'INR' },
    discountCodes: cart?.discountCodes || [],
    checkoutUrl: cart?.checkoutUrl || null,
    loading,
    error,
    addToCart,
    updateQuantity,
    removeFromCart,
    applyDiscount,
    removeDiscount,
    clearCart,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
