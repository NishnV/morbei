export default {
    plugins: {
        // Injects the @custom-media tokens into every CSS file so pages
        // can use them without importing breakpoints.css themselves.
        '@csstools/postcss-global-data': {
            files: ['./src/styles/breakpoints.css'],
        },
        'postcss-custom-media': {},
    },
};
