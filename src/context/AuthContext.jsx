/**
 * AuthContext — Shopify Customer Account State Management
 *
 * Provides authentication state and actions to all components via React Context.
 * Customer access token is persisted in localStorage with expiry handling.
 *
 * Uses Shopify Storefront API mutations for auth and account operations.
 */

import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { shopifyFetch } from '../lib/shopify';
import { authAPI, setToken as setBackendToken, clearToken as clearBackendToken, backendSession } from '../lib/api';
import {
  CUSTOMER_ACCESS_TOKEN_CREATE_MUTATION,
  CUSTOMER_ACCESS_TOKEN_DELETE_MUTATION,
  CUSTOMER_ACCESS_TOKEN_RENEW_MUTATION,
  CUSTOMER_RECOVER_MUTATION,
  CUSTOMER_RESET_BY_URL_MUTATION,
  CUSTOMER_QUERY,
  CUSTOMER_UPDATE_MUTATION,
  CUSTOMER_ADDRESS_CREATE_MUTATION,
  CUSTOMER_ADDRESS_UPDATE_MUTATION,
  CUSTOMER_ADDRESS_DELETE_MUTATION,
  CUSTOMER_DEFAULT_ADDRESS_UPDATE_MUTATION,
} from '../graphql/customer';
import { flattenEdges } from '../utils/normalizeProduct';

export const AuthContext = createContext(null);

const TOKEN_KEY = 'morbei_customer_token';
const TOKEN_EXPIRY_KEY = 'morbei_customer_token_expiry';

// Checkout state to drop on sign-out. Includes the key an older build used, so
// a blob written before the ownership fix cannot outlive this deploy.
// The email proof (see lib/api.js) goes with it: it belongs to whoever was
// using this tab, and that person has just left.
const CHECKOUT_SESSION_KEYS = ['morbei_checkout_form', 'morbei_checkout_delivery', 'morbei_email_proof'];

/**
 * Whether the stored backend token needs replacing by an account session.
 *
 * Absent, obviously. But also when it is a guest token: a guest who then
 * signed in kept their guest session, because every exchange was guarded on
 * the token being absent — so their order history showed only what that one
 * guest checkout had placed, not the account's.
 */
function needsAccountSession() {
  const current = backendSession();
  return !current || current.guest || current.expired;
}

// Renew a Shopify customer session only inside this window before it lapses.
const RENEW_BEFORE_EXPIRY_MS = 3 * 24 * 60 * 60 * 1000; // 3 days

/**
 * Shopify saves every order's shipping address into the customer's address
 * book, so repeat orders to a saved address accumulate duplicate entries.
 * The match key is only name + street + zip + country — enough that truly
 * different addresses still show separately. The default address's entry is
 * preferred so the DEFAULT badge and set-default actions keep working.
 *
 * city is deliberately excluded from the key: checkout now collects it
 * properly, but addresses created before that fix carry the state name in the
 * city field, and phone formatting still varies (+91 prefix or not), so
 * including either would stop old and new copies of the same address matching.
 */
function dedupeAddresses(addresses, defaultAddress) {
  const seen = new Map();
  for (const addr of addresses) {
    const key = ['firstName', 'lastName', 'address1', 'address2', 'zip', 'country']
      .map((f) => (addr[f] || '').trim().toLowerCase())
      .join('|');
    if (!seen.has(key) || addr.id === defaultAddress?.id) seen.set(key, addr);
  }
  return [...seen.values()];
}

/**
 * Normalize a raw Shopify customer into a clean shape.
 */
function normalizeCustomer(customer) {
  if (!customer) return null;

  const addresses = dedupeAddresses(flattenEdges(customer.addresses), customer.defaultAddress);
  const orders = flattenEdges(customer.orders).map((order) => ({
    ...order,
    lineItems: flattenEdges(order.lineItems),
    successfulFulfillments: order.successfulFulfillments || [],
  }));

  return {
    id: customer.id,
    firstName: customer.firstName || '',
    lastName: customer.lastName || '',
    email: customer.email || '',
    phone: customer.phone || '',
    acceptsMarketing: customer.acceptsMarketing || false,
    createdAt: customer.createdAt,
    defaultAddress: customer.defaultAddress || null,
    addresses,
    orders,
  };
}

export function AuthProvider({ children }) {
  const [customer, setCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const tokenRef = useRef(localStorage.getItem(TOKEN_KEY));

  /**
   * Store access token and expiry in localStorage.
   */
  const saveToken = useCallback((accessToken, expiresAt) => {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(TOKEN_EXPIRY_KEY, expiresAt);
    tokenRef.current = accessToken;

    // Exchange the Shopify token for a backend JWT (needed for checkout,
    // orders and wishlist APIs). Non-blocking — Shopify auth is the source of truth.
    // Skip when one already exists: logout clears it, so a fresh login always
    // re-exchanges, but routine token renewals on page load don't spam the API.
    if (needsAccountSession()) {
      // Drop a guest token now rather than when the exchange lands, so no
      // request in between is answered with the guest's narrower view.
      clearBackendToken();
      authAPI
        .shopifyLogin(accessToken)
        .then((data) => setBackendToken(data.token))
        .catch((err) => console.error('Backend session exchange failed:', err.message));
    }
  }, []);

  /**
   * Clear stored token and customer state.
   */
  /**
   * Drop the Shopify session, and by default the backend one with it.
   *
   * `keepBackend` exists for one case: a visitor with no Shopify token at all.
   * That is what a guest looks like, and a guest's backend token is their only
   * session — wiping it on every mount meant their just-placed order vanished
   * from /order-details on a reload, and they lost the ability to cancel it,
   * while the server-side copy stayed valid for a week regardless.
   */
  const clearAuth = useCallback(({ keepBackend = false, keepCheckout = false } = {}) => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    tokenRef.current = null;
    if (!keepBackend) clearBackendToken();
    // Signing out must take the in-progress checkout with it. It holds the
    // customer's name, phone number and home address, and sessionStorage
    // outlives a sign-out — so on a shared device the next person to sign in
    // was shown the previous one's details. Checkout also scopes the saved
    // form to its owner, but the data should not linger here at all.
    //
    // `keepCheckout` is for the one caller that is not a sign-out: a page
    // load by someone who was never signed in. Clearing there wiped a guest's
    // typed address on every refresh.
    if (!keepCheckout) {
      CHECKOUT_SESSION_KEYS.forEach((key) => {
        try { sessionStorage.removeItem(key); } catch { /* blocked — non-critical */ }
      });
    }
    setCustomer(null);
  }, []);

  /**
   * Check if the stored token is expired.
   */
  const isTokenExpired = useCallback(() => {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiry) return true;
    return new Date(expiry) <= new Date();
  }, []);

  /**
   * Whether the session is close enough to expiry to be worth renewing.
   * Shopify issues customer tokens with a long life, so renewing on every page
   * load bought nothing and cost a blocking round-trip each time.
   */
  const needsRenewal = useCallback(() => {
    const expiry = localStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!expiry) return true;
    return new Date(expiry).getTime() - Date.now() < RENEW_BEFORE_EXPIRY_MS;
  }, []);

  /**
   * Fetch the current customer profile using the stored access token.
   */
  const fetchCustomer = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return null;

    const data = await shopifyFetch({
      query: CUSTOMER_QUERY,
      variables: { customerAccessToken: token },
    });

    return normalizeCustomer(data.customer);
  }, []);

  /**
   * Bootstrap: load customer on mount if token exists and is valid.
   */
  useEffect(() => {
    async function initAuth() {
      const token = localStorage.getItem(TOKEN_KEY);
      if (!token) {
        // No Shopify token has nothing to say about a guest session, which is
        // issued separately at checkout and is all a guest has.
        clearAuth({ keepBackend: true, keepCheckout: true });
        setLoading(false);
        return;
      }
      if (isTokenExpired()) {
        // A lapsed Shopify session does take its backend token with it: that
        // one is bound to the account, not to a guest checkout.
        clearAuth();
        setLoading(false);
        return;
      }

      try {
        // Renew only when the session is actually close to expiring. This ran
        // on every single page load, spending a Storefront round-trip before
        // the customer query could even start — for a token with three weeks
        // of life left.
        let renewed = null;
        if (needsRenewal()) {
          const renewData = await shopifyFetch({
            query: CUSTOMER_ACCESS_TOKEN_RENEW_MUTATION,
            variables: { customerAccessToken: token },
          });
          renewed = renewData.customerAccessTokenRenew?.customerAccessToken;
        }

        if (renewed) {
          saveToken(renewed.accessToken, renewed.expiresAt);
        } else if (needsAccountSession()) {
          // Session still valid but not renewed — make sure the backend JWT
          // exists, and that it is the account's rather than a guest's.
          clearBackendToken();
          authAPI
            .shopifyLogin(token)
            .then((data) => setBackendToken(data.token))
            .catch(() => {});
        }

        const cust = await fetchCustomer();
        setCustomer(cust);
      } catch {
        clearAuth();
      } finally {
        setLoading(false);
      }
    }

    initAuth();
  }, [clearAuth, fetchCustomer, isTokenExpired, needsRenewal, saveToken]);

  /**
   * Create a new customer account.
   *
   * Goes through our own server rather than Shopify's customerCreate, which
   * it used to call directly. Two reasons, both documented at the endpoint:
   * Shopify sends its own welcome email on every storefront account creation
   * and there is no way to turn that off on this plan, and a mutation the
   * browser can call is a mutation that can be called without verifying the
   * email first.
   *
   * Signing in is unchanged — Shopify still issues the customer token, and
   * that sign-in is what triggers our welcome.
   *
   * @param {Object} input - { firstName, lastName, email, password }
   */
  const signUp = useCallback(
    async ({ firstName, lastName, email, password, phone, acceptsMarketing }) => {
      try {
        setError(null);

        await authAPI.signup({
          firstName, lastName, email, password,
          phone: phone || undefined,
          acceptsMarketing: acceptsMarketing || false,
        });

        // Auto-login after successful sign up
        await login(email, password);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    []
  );

  /**
   * Log in with email and password.
   *
   * @param {string} email
   * @param {string} password
   */
  const login = useCallback(
    async (email, password) => {
      try {
        setError(null);

        const data = await shopifyFetch({
          query: CUSTOMER_ACCESS_TOKEN_CREATE_MUTATION,
          variables: { input: { email, password } },
        });

        const errors = data.customerAccessTokenCreate.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

        const { accessToken, expiresAt } = data.customerAccessTokenCreate.customerAccessToken;
        saveToken(accessToken, expiresAt);

        const cust = await fetchCustomer();
        setCustomer(cust);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [fetchCustomer, saveToken]
  );

  /**
   * Log out the current customer.
   */
  const logout = useCallback(async () => {
    try {
      setError(null);
      const token = tokenRef.current;

      // Revoke both sessions. The backend JWT is the one that authorises
      // payments and refunds — dropping it from localStorage alone leaves it
      // valid server-side for its full lifetime, so tell the server too.
      await Promise.allSettled([
        token
          ? shopifyFetch({
              query: CUSTOMER_ACCESS_TOKEN_DELETE_MUTATION,
              variables: { customerAccessToken: token },
            })
          : Promise.resolve(),
        localStorage.getItem('morbei_token') ? authAPI.logout() : Promise.resolve(),
      ]);
    } catch {
      // Proceed with local logout even if either call fails
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  /**
   * Send a password recovery email.
   *
   * @param {string} email
   */
  const recoverPassword = useCallback(async (email) => {
    try {
      setError(null);

      const data = await shopifyFetch({
        query: CUSTOMER_RECOVER_MUTATION,
        variables: { email },
      });

      const errors = data.customerRecover.customerUserErrors;
      if (errors && errors.length > 0) {
        const msg = errors.map((e) => e.message).join('; ');
        throw new Error(msg);
      }
    } catch (err) {
      setError(err);
      throw err;
    }
  }, []);

  /**
   * Reset password using the reset URL from the recovery email.
   *
   * @param {string} resetUrl - Shopify reset URL
   * @param {string} password - New password
   */
  const resetPassword = useCallback(
    async (resetUrl, password) => {
      try {
        setError(null);

        const data = await shopifyFetch({
          query: CUSTOMER_RESET_BY_URL_MUTATION,
          variables: { resetUrl, password },
        });

        const errors = data.customerResetByUrl.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

        const token = data.customerResetByUrl.customerAccessToken;
        if (token) {
          saveToken(token.accessToken, token.expiresAt);
          const cust = await fetchCustomer();
          setCustomer(cust);
        }
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [fetchCustomer, saveToken]
  );

  /**
   * Update the current customer's profile.
   *
   * @param {Object} fields - { firstName, lastName, email, phone, acceptsMarketing, password }
   */
  const updateProfile = useCallback(
    async (fields) => {
      try {
        setError(null);
        const token = tokenRef.current;
        if (!token) throw new Error('Not authenticated');

        const data = await shopifyFetch({
          query: CUSTOMER_UPDATE_MUTATION,
          variables: { customerAccessToken: token, customer: fields },
        });

        const errors = data.customerUpdate.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

        // If token was refreshed, save the new one
        const newToken = data.customerUpdate.customerAccessToken;
        if (newToken) {
          saveToken(newToken.accessToken, newToken.expiresAt);
        }

        const cust = await fetchCustomer();
        setCustomer(cust);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [fetchCustomer, saveToken]
  );

  /**
   * Add a new address to the customer's address book.
   *
   * @param {Object} address - MailingAddressInput fields
   */
  const addAddress = useCallback(
    async (address) => {
      try {
        setError(null);
        const token = tokenRef.current;
        if (!token) throw new Error('Not authenticated');

        const data = await shopifyFetch({
          query: CUSTOMER_ADDRESS_CREATE_MUTATION,
          variables: { customerAccessToken: token, address },
        });

        const errors = data.customerAddressCreate.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

        const cust = await fetchCustomer();
        setCustomer(cust);
        return data.customerAddressCreate.customerAddress;
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [fetchCustomer]
  );

  /**
   * Update an existing address.
   *
   * @param {string} id - Address GID
   * @param {Object} address - Updated MailingAddressInput fields
   */
  const updateAddress = useCallback(
    async (id, address) => {
      try {
        setError(null);
        const token = tokenRef.current;
        if (!token) throw new Error('Not authenticated');

        const data = await shopifyFetch({
          query: CUSTOMER_ADDRESS_UPDATE_MUTATION,
          variables: { customerAccessToken: token, id, address },
        });

        const errors = data.customerAddressUpdate.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

        const cust = await fetchCustomer();
        setCustomer(cust);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [fetchCustomer]
  );

  /**
   * Delete an address from the customer's address book.
   *
   * @param {string} id - Address GID to delete
   */
  const deleteAddress = useCallback(
    async (id) => {
      try {
        setError(null);
        const token = tokenRef.current;
        if (!token) throw new Error('Not authenticated');

        const data = await shopifyFetch({
          query: CUSTOMER_ADDRESS_DELETE_MUTATION,
          variables: { customerAccessToken: token, id },
        });

        const errors = data.customerAddressDelete.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

        const cust = await fetchCustomer();
        setCustomer(cust);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [fetchCustomer]
  );

  /**
   * Set a default shipping address.
   *
   * @param {string} addressId - Address GID
   */
  const setDefaultAddress = useCallback(
    async (addressId) => {
      try {
        setError(null);
        const token = tokenRef.current;
        if (!token) throw new Error('Not authenticated');

        const data = await shopifyFetch({
          query: CUSTOMER_DEFAULT_ADDRESS_UPDATE_MUTATION,
          variables: { customerAccessToken: token, addressId },
        });

        const errors = data.customerDefaultAddressUpdate.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

        const cust = await fetchCustomer();
        setCustomer(cust);
      } catch (err) {
        setError(err);
        throw err;
      }
    },
    [fetchCustomer]
  );

  /**
   * Manually refresh the customer data.
   */
  const refreshCustomer = useCallback(async () => {
    try {
      setError(null);
      const cust = await fetchCustomer();
      setCustomer(cust);
    } catch (err) {
      setError(err);
    }
  }, [fetchCustomer]);

  const value = {
    customer,
    isAuthenticated: !!customer,
    loading,
    error,
    signUp,
    login,
    logout,
    recoverPassword,
    resetPassword,
    updateProfile,
    addAddress,
    updateAddress,
    deleteAddress,
    setDefaultAddress,
    refreshCustomer,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
