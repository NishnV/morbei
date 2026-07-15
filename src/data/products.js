// Central product data for frontend mockup.
// This file serves as the source of truth for all products in the frontend.

export const products = {
    "NEW IN": [],
    "DRESSES": [],
    "TOPS": [],
    "BOTTOMS": [],
    "UPCOMING": []
};

// Helper function to get all products
export const getAllProducts = () => {
    return Object.values(products).flat();
};

// Helper function to get product by ID
export const getProductById = (id) => {
    const allProducts = getAllProducts();
    return allProducts.find(product => product.id === id);
};

// Helper function to get products by category
export const getProductsByCategory = (category) => {
    if (category === 'all') {
        return getAllProducts();
    }
    return products[category.toUpperCase()] || [];
};
