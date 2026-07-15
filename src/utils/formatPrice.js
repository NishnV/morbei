/**
 * Currency formatting utility using Intl.NumberFormat.
 * Works with Shopify's MoneyV2 type ({ amount: string, currencyCode: string }).
 */

/**
 * Format a Shopify MoneyV2 object into a display string.
 *
 * @param {Object} money - Shopify MoneyV2 object
 * @param {string} money.amount - Numeric string (e.g., "5000.0")
 * @param {string} money.currencyCode - ISO 4217 currency code (e.g., "INR")
 * @returns {string} Formatted price string (e.g., "₹5,000.00" or "RS. 5000")
 */
export function formatPrice(money) {
  if (!money || !money.amount) return '';

  const amount = parseFloat(money.amount);
  const currencyCode = money.currencyCode || 'INR';

  // Use the MORBEI convention: "RS. X,XXX" for INR
  if (currencyCode === 'INR') {
    return `RS. ${Math.round(amount).toLocaleString('en-IN')}`;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Get raw numeric price from a MoneyV2 object.
 *
 * @param {Object} money - Shopify MoneyV2 object
 * @returns {number} The numeric price value
 */
export function getNumericPrice(money) {
  if (!money || !money.amount) return 0;
  return parseFloat(money.amount);
}

/**
 * Check if a product is on sale by comparing price to compareAtPrice.
 *
 * @param {Object} price - MoneyV2 current price
 * @param {Object|null} compareAtPrice - MoneyV2 original price (nullable)
 * @returns {boolean} True if the product is on sale
 */
export function isOnSale(price, compareAtPrice) {
  if (!compareAtPrice || !compareAtPrice.amount) return false;
  return parseFloat(compareAtPrice.amount) > parseFloat(price.amount);
}

/**
 * Calculate the discount percentage between original and sale price.
 *
 * @param {Object} price - MoneyV2 current price
 * @param {Object} compareAtPrice - MoneyV2 original price
 * @returns {number} Discount percentage (0 if not on sale)
 */
export function getDiscountPercentage(price, compareAtPrice) {
  if (!isOnSale(price, compareAtPrice)) return 0;
  const original = parseFloat(compareAtPrice.amount);
  const current = parseFloat(price.amount);
  return Math.round(((original - current) / original) * 100);
}
