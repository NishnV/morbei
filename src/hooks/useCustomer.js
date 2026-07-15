/**
 * Hook for customer authentication and account management.
 *
 * Wraps the AuthContext and provides a clean API.
 * Most consumers should use `useCustomer()` from this file.
 */

import { useContext } from 'react';
import { AuthContext } from '../context/AuthContext';

/**
 * Access the authentication state and actions from AuthContext.
 *
 * @returns {Object} Auth state and action methods:
 *   - customer: current customer profile object or null
 *   - isAuthenticated: boolean
 *   - loading: boolean
 *   - error: Error|null
 *   - signUp({ firstName, lastName, email, password }): create account
 *   - login(email, password): sign in
 *   - logout(): sign out
 *   - recoverPassword(email): trigger password reset email
 *   - resetPassword(resetUrl, password): set new password
 *   - updateProfile(fields): update name, email, phone, etc.
 *   - addAddress(address): add new address
 *   - updateAddress(id, address): update existing address
 *   - deleteAddress(id): remove address
 *   - setDefaultAddress(id): set default shipping address
 *   - refreshCustomer(): re-fetch current customer data
 */
export function useCustomer() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useCustomer must be used within an AuthProvider');
  }
  return context;
}
