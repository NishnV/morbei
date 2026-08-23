/**
 * Normalize raw Shopify Storefront API product responses into the
 * flat shape expected by the MORBEI frontend components.
 *
 * The frontend expects:
 * {
 *   id: string,
 *   shopifyId: string (full GID),
 *   name: string,
 *   handle: string,
 *   description: string,
 *   price: string (e.g., "RS. 5000"),
 *   priceNum: number,
 *   compareAtPrice: string | null,
 *   compareAtPriceNum: number | null,
 *   isOnSale: boolean,
 *   currency: string,
 *   category: string,
 *   images: string[],
 *   media: Array<{ kind: 'image', url } | { kind: 'video', poster, alt, sources }>,
 *   img: string,
 *   sizes: string[],
 *   colors: string[],
 *   taxonomyColors: Array<{ label, hex, handle }>,
 *   variants: Array<{ id, title, size, color, price, priceNum, compareAtPrice,
 *                      available, quantityAvailable, image }>,
 *   vendor: string,
 *   productType: string,
 *   tags: string[],
 *   availableForSale: boolean,
 *   metafields: { productMeasurement, compositionAndCare, shipping,
 *                 sizeGuide, material, careInstructions, fitType, badge,
 *                 modelInfo, measurements },
 *   seo: { title, description }
 * }
 */

import { parseShopifyId } from './parseShopifyId';

/**
 * Extract edges from a Shopify connection (edges/node pattern).
 *
 * @param {Object} connection - A Shopify connection object with edges[].node
 * @returns {Array} Array of node objects
 */
export function flattenEdges(connection) {
  if (!connection?.edges) return [];
  return connection.edges.map((edge) => edge.node);
}

/**
 * Normalize a raw Shopify product into the frontend-compatible shape.
 *
 * @param {Object} product - Raw product from Shopify Storefront API
 * @returns {Object} Normalized product object compatible with MORBEI components
 */
/**
 * Shopify's standard `shopify.color-pattern` taxonomy metafield.
 *
 * Each reference is a built-in metaobject with a `label` ("Black") and a
 * `color` hex ("#000000") — so the swatch shows the merchant's actual colour
 * instead of one inferred from the name. Only present on the single-product
 * queries; returns [] everywhere else.
 */
function normalizeTaxonomyColors(colorPattern) {
  const nodes = flattenEdges(colorPattern?.references);
  return nodes
    .map((node) => {
      const fields = Object.fromEntries((node?.fields || []).map((f) => [f.key, f.value]));
      const label = fields.label?.trim();
      if (!label) return null;
      return {
        label,
        // `color` is a hex from Shopify. Absent for some pattern-only entries,
        // in which case the UI falls back to matching the label by name.
        hex: fields.color?.trim() || null,
        handle: node.handle || null,
      };
    })
    .filter(Boolean);
}

/**
 * Flatten the `media` connection into the gallery's render list.
 *
 * Returns one entry per media item in the merchant's chosen order, so a video
 * placed second in the Shopify admin stays second on the page. Two shapes:
 *
 *   { kind: 'image', url }
 *   { kind: 'video', poster, sources: [{ url, mimeType, width, height }] }
 *
 * `sources` is sorted widest-first and holds only the MP4 renditions. Shopify
 * also returns an HLS stream, which Safari plays natively but Chrome and
 * Firefox cannot without a JS player — progressive MP4 is the one format every
 * browser here handles, and `<video>` picks the first source it can play.
 *
 * Only the single-product queries request media. Everywhere else this returns
 * [] and the caller falls back to `images`.
 */
function normalizeMedia(media) {
  return flattenEdges(media)
    .map((node) => {
      if (node?.mediaContentType === 'IMAGE') {
        return node.image?.url ? { kind: 'image', url: node.image.url } : null;
      }
      if (node?.mediaContentType === 'VIDEO') {
        const sources = (node.sources || [])
          .filter((src) => src.mimeType === 'video/mp4')
          .sort((a, b) => (b.width || 0) - (a.width || 0));
        if (!sources.length) return null;
        return {
          kind: 'video',
          poster: node.previewImage?.url || null,
          alt: node.alt || '',
          sources,
        };
      }
      // 3D models and external video are not uploaded for this catalogue and
      // have no gallery treatment — dropping them is better than an empty tile.
      return null;
    })
    .filter(Boolean);
}

export function normalizeProduct(product) {
  if (!product) return null;

  const images = flattenEdges(product.images).map((img) => img.url);
  // Falls back to the images when the query didn't ask for media, so a caller
  // working from a list query still gets a usable gallery list.
  const mediaList = normalizeMedia(product.media);
  const media = mediaList.length ? mediaList : images.map((url) => ({ kind: 'image', url }));
  const variants = flattenEdges(product.variants);
  const metafieldsArray = (product.metafields || []).filter(Boolean);

  // Build metafields map
  const metafields = {};
  for (const mf of metafieldsArray) {
    switch (mf.key) {
      // The three the store actually defines — one per accordion on the product
      // page. The keys below them predate those definitions and have never
      // existed in this shop; they stay mapped so a merchant who does define
      // them still gets the finer-grained rendering.
      case 'product_measurement':
        metafields.productMeasurement = mf.value;
        break;
      case 'composition_and_care':
        metafields.compositionAndCare = mf.value;
        break;
      case 'shipping':
        metafields.shipping = mf.value;
        break;
      case 'size_guide':
        metafields.sizeGuide = mf.value;
        break;
      case 'material':
        metafields.material = mf.value;
        break;
      case 'care_instructions':
        metafields.careInstructions = mf.value;
        break;
      case 'fit_type':
        metafields.fitType = mf.value;
        break;
      case 'badge':
        metafields.badge = mf.value;
        break;
      // Both of these were already read by ProductDetail — the model line under
      // ADD TO BAG and the PRODUCT MEASUREMENTS accordion — but were never
      // requested from Shopify or mapped here, so they silently resolved to
      // undefined and the UI always showed its fallback.
      case 'model_info':
        metafields.modelInfo = mf.value;
        break;
      case 'measurements':
        metafields.measurements = mf.value;
        break;
    }
  }

  // Extract unique sizes and colors from variants
  const sizes = [];
  const colors = [];
  for (const v of variants) {
    for (const opt of v.selectedOptions || []) {
      if (opt.name.toLowerCase() === 'size' && !sizes.includes(opt.value)) {
        sizes.push(opt.value);
      }
      if (opt.name.toLowerCase() === 'color' && !colors.includes(opt.value)) {
        colors.push(opt.value);
      }
    }
  }

  // Price info from the first variant or priceRange
  const minPrice = product.priceRange?.minVariantPrice;
  const compareAtMin = product.compareAtPriceRange?.minVariantPrice;
  const priceNum = minPrice ? parseFloat(minPrice.amount) : 0;
  const compareAtPriceNum =
    compareAtMin && parseFloat(compareAtMin.amount) > priceNum
      ? parseFloat(compareAtMin.amount)
      : null;
  const currency = minPrice?.currencyCode || 'INR';

  // Format price in MORBEI style
  const formatRS = (num) => {
    if (currency === 'INR') return `RS. ${Math.round(num).toLocaleString('en-IN')}`;
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num);
  };

  // Map category from productType or tags
  const categoryMap = {
    dresses: 'DRESSES',
    dress: 'DRESSES',
    tops: 'TOPS',
    top: 'TOPS',
    bottoms: 'BOTTOMS',
    bottom: 'BOTTOMS',
    pants: 'BOTTOMS',
    trousers: 'BOTTOMS',
  };
  const typeLower = (product.productType || '').toLowerCase();
  const category = categoryMap[typeLower] || product.productType?.toUpperCase() || 'NEW IN';

  return {
    id: parseShopifyId(product.id),
    shopifyId: product.id,
    name: product.title,
    handle: product.handle,
    description: product.description || '',
    descriptionHtml: product.descriptionHtml || '',
    price: formatRS(priceNum),
    priceNum,
    compareAtPrice: compareAtPriceNum ? formatRS(compareAtPriceNum) : null,
    compareAtPriceNum,
    isOnSale: compareAtPriceNum !== null,
    currency,
    category,
    images,
    // Images and video in admin order. `images` stays images-only — the grid,
    // cart, wishlist and OG tags all want a still and nothing else.
    media,
    img: images[0] || '/placeholder.png',
    sizes: sizes.length > 0 ? sizes : ['S', 'M', 'L'],
    colors,
    // Colour from Shopify's product taxonomy, used when the product has no
    // Colour variant option (the common case here — every product is a single
    // colourway sized S-XL). [] when the merchant hasn't set it.
    taxonomyColors: normalizeTaxonomyColors(product.colorPattern),
    variants: variants.map((v) => ({
      id: v.id,
      title: v.title,
      size: v.selectedOptions?.find((o) => o.name.toLowerCase() === 'size')?.value || '',
      color: v.selectedOptions?.find((o) => o.name.toLowerCase() === 'color')?.value || '',
      price: formatRS(parseFloat(v.price?.amount || 0)),
      priceNum: parseFloat(v.price?.amount || 0),
      compareAtPrice:
        v.compareAtPrice && parseFloat(v.compareAtPrice.amount) > parseFloat(v.price?.amount || 0)
          ? formatRS(parseFloat(v.compareAtPrice.amount))
          : null,
      available: v.availableForSale,
      quantityAvailable: v.quantityAvailable,
      image: v.image?.url || images[0] || '/placeholder.png',
    })),
    vendor: product.vendor || '',
    productType: product.productType || '',
    tags: product.tags || [],
    availableForSale: product.availableForSale,
    metafields,
    seo: product.seo || { title: '', description: '' },
  };
}

/**
 * Normalize a collection response from Shopify.
 *
 * @param {Object} collection - Raw collection from Shopify
 * @returns {Object} Normalized collection object
 */
export function normalizeCollection(collection) {
  if (!collection) return null;

  const metafieldsArray = (collection.metafields || []).filter(Boolean);
  const metafields = {};
  for (const mf of metafieldsArray) {
    if (mf.key === 'banner_image') metafields.bannerImage = mf.value;
    if (mf.key === 'seo_description') metafields.seoDescription = mf.value;
  }

  return {
    id: collection.id,
    title: collection.title,
    handle: collection.handle,
    description: collection.description || '',
    image: collection.image?.url || null,
    imageAlt: collection.image?.altText || '',
    seo: collection.seo || { title: '', description: '' },
    metafields,
  };
}

/**
 * Normalize a cart line item into the shape expected by MORBEI's cart components.
 *
 * @param {Object} line - A cart line node from the Shopify cart query
 * @returns {Object} Normalized cart item
 */
export function normalizeCartLine(line) {
  const variant = line.merchandise;
  const product = variant.product;
  const productImages = flattenEdges(product?.images);

  const size = variant.selectedOptions?.find((o) => o.name.toLowerCase() === 'size')?.value || '';
  const color = variant.selectedOptions?.find((o) => o.name.toLowerCase() === 'color')?.value || '';
  const priceNum = parseFloat(variant.price?.amount || 0);

  return {
    lineId: line.id,
    id: parseShopifyId(product?.id || ''),
    shopifyProductId: product?.id || '',
    variantId: variant.id,
    name: product?.title || variant.title || '',
    handle: product?.handle || '',
    size,
    color,
    quantity: line.quantity,
    price: priceNum,
    priceNum,
    img: variant.image?.url || productImages[0]?.url || '/placeholder.png',
    variantTitle: variant.title || '',
    vendor: product?.vendor || '',
    productType: product?.productType || '',
  };
}
