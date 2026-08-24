/**
 * Parse the merchant-authored measurement table out of a product metafield.
 *
 * `custom.product_measurement` is a multi_line_text_field, so the table is
 * typed as pipe-separated rows with a header row on top:
 *
 *   SIZE | BUST | WAIST | LENGTH
 *   XXS  | 30   | 24    | 26
 *   XS   | 32   | 26    | 26
 *
 * The header row is whatever the merchant types, which is the point: a top
 * declares BUST/WAIST/LENGTH and trousers declare WAIST/HIP/INSEAM without
 * either the schema or this file knowing about garment types.
 *
 * Returns null for anything that isn't a table — including the single-line
 * form these fields hold today ("Bust-34in, Waist-28in") — so the caller can
 * fall back to rendering the text as-is rather than showing an empty dialog.
 */
export function parseMeasurementTable(text) {
    if (!text) return null;

    const lines = String(text).split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return null;

    const grid = lines.map((line) => line.split('|').map((cell) => cell.trim()));
    // A header plus at least one row, each with at least two columns.
    if (grid[0].length < 2) return null;

    const width = grid[0].length;
    const rows = grid.slice(1)
        // Ragged rows are padded rather than rejected: one mistyped line
        // shouldn't drop the whole table back to plain text.
        .map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
        .filter((row) => row.some(Boolean));

    if (!rows.length) return null;
    return { headers: grid[0], rows };
}

/** A cell that is only a number, a decimal, or a range of them. */
const NUMERIC_CELL = /^\d+(\.\d+)?(\s*[–—-]\s*\d+(\.\d+)?)?$/;

/**
 * Convert a row's measurements from inches to centimetres.
 *
 * The merchant enters one set of numbers and the CM toggle is derived, so the
 * two units cannot drift apart. Column 0 is left alone — it holds the size
 * label — and so is any cell that isn't purely numeric, which keeps notes like
 * "one size" intact.
 */
export function rowToCm(row) {
    return row.map((cell, i) => {
        if (i === 0 || !NUMERIC_CELL.test(cell)) return cell;
        return cell.replace(/\d+(\.\d+)?/g, (n) => {
            const cm = parseFloat(n) * 2.54;
            return String(Math.round(cm * 10) / 10);
        });
    });
}
