/**
 * Colour-name → swatch colour.
 *
 * The swatches used to render `background: color.toLowerCase()` straight into
 * CSS. That works for 'Black' and 'Ivory' because they happen to be CSS named
 * colours, and fails silently — transparent swatch — for exactly the vocabulary
 * a fashion label actually uses: Ecru, Sand, Taupe, Bone, Oat.
 *
 * (No product in the catalogue has a Colour option today, so this path is
 * currently unreachable. It is written now so that adding one doesn't ship a
 * row of invisible swatches.)
 *
 * Resolution order:
 *   1. the palette below, matched loosely so "Off White" and "off-white" agree
 *   2. any value the browser accepts as a colour (covers hex codes and the
 *      CSS named colours, so a merchant can type "#C8B9A6" directly)
 *   3. null — the caller shows a neutral placeholder rather than a wrong colour
 */

const PALETTE = {
    // Neutrals — the bulk of a minimalist range
    ecru: '#D8CFC0',
    bone: '#E3DCD2',
    oat: '#DDD3C3',
    oatmeal: '#DDD3C3',
    sand: '#D2C3AC',
    stone: '#C8BFB2',
    taupe: '#B3A394',
    greige: '#BFB6AB',
    cream: '#F2EBDD',
    ivory: '#F5F1E6',
    offwhite: '#F3F1EC',
    natural: '#E5DDD3',
    camel: '#B99A72',
    tan: '#C39A6B',
    beige: '#D9C7AE',
    chocolate: '#4E3A2E',
    espresso: '#3A2C24',
    charcoal: '#3A3A3A',
    slate: '#5A6068',
    graphite: '#4A4A4A',
    black: '#111111',
    white: '#FFFFFF',

    // Colour
    navy: '#1F2A44',
    midnight: '#191E2B',
    olive: '#6B6B47',
    khaki: '#8F8562',
    sage: '#A3B18A',
    forest: '#2F4F3E',
    burgundy: '#5C1F2B',
    wine: '#6B2737',
    rust: '#9C4A2F',
    terracotta: '#B45F45',
    brick: '#8C4A3C',
    blush: '#E3C4BE',
    rose: '#D89A96',
    dusty_rose: '#C89A94',
    mauve: '#A08491',
    lilac: '#B9A7C4',
    lavender: '#B7A9C9',
    powder_blue: '#B7C7D4',
    sky: '#A9C1D4',
    denim: '#4A6076',
    mustard: '#C79A34',
    ochre: '#B8862F',
    butter: '#F0E2B0',
    emerald: '#2E6B54',
    teal: '#2E6B6B',
};

/** Loose key: strip spaces, hyphens and case so "Off White" == "off-white". */
const normalise = (name) => String(name || '').toLowerCase().replace(/[\s-]+/g, '');

const LOOKUP = Object.fromEntries(
    Object.entries(PALETTE).map(([k, v]) => [normalise(k), v])
);

/**
 * Resolve a colour option value to something renderable.
 * @returns {string|null} a CSS colour, or null when it can't be determined.
 */
export function colorToSwatch(name) {
    if (!name) return null;

    const key = normalise(name);
    if (LOOKUP[key]) return LOOKUP[key];

    // A multi-word name often ends in its base colour: "Washed Black", "Deep Navy".
    const words = String(name).toLowerCase().split(/[\s-]+/).filter(Boolean);
    for (let i = words.length - 1; i >= 0; i--) {
        const hit = LOOKUP[normalise(words[i])];
        if (hit) return hit;
    }

    // Hex codes and CSS named colours the palette doesn't cover.
    // CSS.supports is unavailable during SSR/tests — treat that as unknown.
    if (typeof CSS !== 'undefined' && CSS.supports?.('color', name)) return name;

    return null;
}
