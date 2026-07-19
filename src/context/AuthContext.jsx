/**
 * AuthContext — Shopify Customer Account State Management
 *
 * Provides authentication state and actions to all components via React Context.
 * Customer access token is persisted in localStorage with expiry handling.
 *
 * Uses Shopify Storefront API mutations for auth and account operations.
 */

import React, { createContext, useState, useEffect, useCallback, useRef } from 'react';
import { shopifyFetch, handleUserErrors } from '../lib/shopify';
import { authAPI, setToken as setBackendToken, clearToken as clearBackendToken } from '../lib/api';
import {
  CUSTOMER_CREATE_MUTATION,
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

/**
 * Shopify saves every order's shipping address into the customer's address
 * book, so repeat orders to a saved address accumulate duplicate entries.
 * Checkout-created copies mangle city (state-as-city) and phone (+91 prefix),
 * so the match key is only name + street + zip + country — enough that truly
 * different addresses still show separately. The default address's entry is
 * preferred so the DEFAULT badge and set-default actions keep working.
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
    if (!localStorage.getItem('morbei_token')) {
      authAPI
        .shopifyLogin(accessToken)
        .then((data) => setBackendToken(data.token))
        .catch((err) => console.error('Backend session exchange failed:', err.message));
    }
  }, []);

  /**
   * Clear stored token and customer state.
   */
  const clearAuth = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_EXPIRY_KEY);
    tokenRef.current = null;
    clearBackendToken();
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
      if (!token || isTokenExpired()) {
        clearAuth();
        setLoading(false);
        return;
      }

      try {
        // Try to renew the token first
        const renewData = await shopifyFetch({
          query: CUSTOMER_ACCESS_TOKEN_RENEW_MUTATION,
          variables: { customerAccessToken: token },
        });

        const renewed = renewData.customerAccessTokenRenew?.customerAccessToken;
        if (renewed) {
          saveToken(renewed.accessToken, renewed.expiresAt);
        } else if (!localStorage.getItem('morbei_token')) {
          // Session still valid but not renewed — make sure the backend JWT exists
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
  }, [clearAuth, fetchCustomer, isTokenExpired, saveToken]);

  /**
   * Create a new customer account.
   *
   * @param {Object} input - { firstName, lastName, email, password }
   */
  const signUp = useCallback(
    async ({ firstName, lastName, email, password, phone, acceptsMarketing }) => {
      try {
        setError(null);

        const input = { firstName, lastName, email, password, acceptsMarketing: acceptsMarketing || false };
        if (phone) input.phone = phone;

        const data = await shopifyFetch({
          query: CUSTOMER_CREATE_MUTATION,
          variables: { input },
        });

        const errors = data.customerCreate.customerUserErrors;
        if (errors && errors.length > 0) {
          const msg = errors.map((e) => e.message).join('; ');
          throw new Error(msg);
        }

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

      if (token) {
        await shopifyFetch({
          query: CUSTOMER_ACCESS_TOKEN_DELETE_MUTATION,
          variables: { customerAccessToken: token },
        });
      }
    } catch {
      // Proceed with local logout even if API call fails
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
