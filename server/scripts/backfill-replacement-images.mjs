/**
 * Give replacement orders their picture back.
 *
 * An exchange raises a replacement order, and the row recording it was
 * written with the title, the size, and nothing else — no image, and only
 * the size rather than the garment's full options. So the one order a
 * customer is most anxious about drew an empty grey box in the admin list,
 * in the dispatch email and in their own order history, and read "XS" where
 * the order it replaced read "S / Black".
 *
 * The exchange path now stores both. This repairs the rows written before
 * it did. Run it where the database actually is:
 *
 *   railway run node server/scripts/backfill-replacement-images.mjs          # shows what it would do
 *   railway run node server/scripts/backfill-replacement-images.mjs --apply  # does it
 *
 * Safe to run twice: a line that already has an image is left alone, and a
 * variant Shopify cannot resolve is reported and skipped rather than
 * blanking what is there. Nothing but the items JSON of replacement orders
 * is touched.
 */
import { all, run } from '../db/pg.js';
import { lineDetailsForVariant } from '../services/shopify-admin.js';

const APPLY = process.argv.includes('--apply');

const rows = await all(
    `SELECT id, shopify_order_number, items FROM orders
      WHERE replacement_for_order_id IS NOT NULL
      ORDER BY id`
);

console.log(`${rows.length} replacement order${rows.length === 1 ? '' : 's'} found.\n`);

let changed = 0, skipped = 0, failed = 0;

for (const row of rows) {
    let items;
    try { items = JSON.parse(row.items || '[]'); } catch { items = []; }
    if (!Array.isArray(items) || !items.length) {
        console.log(`#${row.shopify_order_number}: no line items — skipped`);
        skipped++;
        continue;
    }

    let touched = false;
    for (const item of items) {
        if (item.image) continue;           // already fine, or fixed on a previous run
        if (!item.variantId) { failed++; console.log(`#${row.shopify_order_number}: a line has no variant id`); continue; }

        const details = await lineDetailsForVariant(String(item.variantId).split('/').pop());
        if (!details) {
            failed++;
            console.log(`#${row.shopify_order_number}: Shopify could not resolve variant ${item.variantId}`);
            continue;
        }
        item.image = details.image;
        if (details.title) item.title = details.title;
        // Only widen the options — never drop a value that is already there
        // for one Shopify happens not to return.
        if (details.selectedOptions?.length > (item.selectedOptions?.length || 0)) {
            item.selectedOptions = details.selectedOptions;
        }
        touched = true;
        const opts = (item.selectedOptions || []).map((o) => o.value).join(' / ');
        console.log(`#${row.shopify_order_number}: ${item.title} — ${opts}`);
        console.log(`   image ${details.image ? '-> ' + details.image : 'still missing on the product itself'}`);
    }

    if (!touched) { skipped++; continue; }
    changed++;
    if (APPLY) {
        await run(`UPDATE orders SET items = $1 WHERE id = $2`, [JSON.stringify(items), row.id]);
    }
}

console.log(`\n${changed} order${changed === 1 ? '' : 's'} ${APPLY ? 'updated' : 'would be updated'}`
    + `, ${skipped} already fine, ${failed} line${failed === 1 ? '' : 's'} could not be resolved.`);
if (changed && !APPLY) console.log('Nothing was written. Re-run with --apply.');
process.exit(0);
