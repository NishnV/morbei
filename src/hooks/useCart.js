/**
 * Hook for cart operations using the Shopify Storefront API.
 *
 * This hook wraps the CartContext and provides a clean API.
 * For direct use without context, see the standalone functions.
 *
 * Most consumers should use the CartContext via `useCart()` from context/CartContext.jsx
 */

import { useContext } from 'react';
import { CartContext } from '../context/CartContext';

/**
 * Access the cart state and actions from CartContext.
 *
 * @returns {Object} Cart state and action methods:
 *   - cart: full normalized cart object
 *   - cartItems: array of normalized cart line items
 *   - cartCount: total quantity of items
 *   - subtotal: cart subtotal (MoneyV2)
 *   - total: cart total (MoneyV2)
 *   - tax: cart total tax (MoneyV2)
 *   - discountCodes: array of applied discount codes
 *   - checkoutUrl: Shopify-hosted checkout URL
 *   - loading: boolean
 *   - error: Error|null
 *   - addToCart(variantId, quantity): add item
 *   - updateQuantity(lineId, quantity): update line item quantity
 *   - removeFromCart(lineId): remove line item
 *   - applyDiscount(code): apply discount code
 *   - removeDiscount(): remove all discount codes
 *   - clearCart(): clear local cart reference
 */
export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return context;
}
