/**
 * Canonical size ordering.
 *
 * The size picker used to sort against a hardcoded
 * ['XXS','XS','S','M','L','XL'] via indexOf, which returns -1 for anything
 * absent — so any size outside that list silently clumped at the front in
 * arbitrary order. That is not hypothetical: the live catalogue already mixes
 * `XXS` and `2XS` for the same size, and neither `2XL` nor numeric sizing
 * appears in the list at all.
 *
 * This normalises the common spellings, orders everything known, and pushes
 * genuinely unrecognised values to the end in a stable order rather than
 * scattering them through the middle.
 */

// Canonical spelling -> rank. Lower sorts first.
const SIZE_RANK = {
    XXXS: 0,
    XXS: 10,
    XS: 20,
    S: 30,
    M: 40,
    L: 50,
    XL: 60,
    XXL: 70,
    XXXL: 80,
    'ONE SIZE': 100,
};

// Numeric-prefix spellings Shopify merchants use interchangeably with the
// letter forms: 2XS === XXS, 3XL === XXXL, and so on.
const NUMERIC_PREFIX = /^([2-5])X([SL])$/;

/** Normalise a size label to its canonical spelling for comparison. */
export function canonicalSize(size) {
    const s = String(size || '').trim().toUpperCase().replace(/\s+/g, ' ');
    const m = s.match(NUMERIC_PREFIX);
    if (m) {
        const [, count, letter] = m;
        return 'X'.repeat(Number(count)) + letter; // 2XS -> XXS, 3XL -> XXXL
    }
    if (s === 'OS' || s === 'ONESIZE' || s === 'ONE-SIZE') return 'ONE SIZE';
    return s;
}

/**
 * Sort size labels smallest to largest, preserving the merchant's own spelling
 * in the output. Unknown labels (numeric sizes, "TALL", anything bespoke) keep
 * their original relative order and sit after the known ones.
 */
export function sortSizes(sizes = []) {
    return [...sizes].sort((a, b) => {
        const ra = SIZE_RANK[canonicalSize(a)];
        const rb = SIZE_RANK[canonicalSize(b)];
        if (ra != null && rb != null) return ra - rb;
        if (ra != null) return -1;   // known sizes before unknown
        if (rb != null) return 1;
        // Both unknown: numeric sizes sort numerically, otherwise alphabetical.
        const na = parseFloat(a);
        const nb = parseFloat(b);
        if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
        return String(a).localeCompare(String(b));
    });
}
