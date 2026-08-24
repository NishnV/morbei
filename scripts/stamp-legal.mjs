#!/usr/bin/env node
/**
 * Keep the "Last Updated" date on the legal pages honest and automatic.
 *
 * The date was hardcoded, so it only moved when someone remembered to move
 * it. The obvious alternative — rendering new Date() — is worse than a stale
 * date, not better: it tells every visitor the policy was revised today,
 * every day, which is exactly the claim the field exists to make truthfully.
 *
 * So the date is stamped from the content instead. This hashes each legal
 * page and, when the hash has moved, records today against it. The date then
 * changes when and only when the document changes.
 *
 *   npm run stamp-legal           update the stamp after editing a policy
 *   npm run stamp-legal -- --check  report drift without writing (prebuild)
 *
 * Deliberately not run as a writing step in CI. A build that stamps its own
 * date would re-stamp on every deploy after an edit — the generated file
 * isn't committed back — and the date would drift to whenever you last
 * deployed rather than when you last wrote. It is committed instead, and the
 * build only warns.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUT = resolve(ROOT, 'src/generated/legal-updated.json');

// Terms is deliberately absent: that document states its own effective date
// in its closing sections, and a second date in the header that could drift
// out of step with it would be worse than no date at all.
const DOCS = [
    { key: 'privacy', file: 'src/pages/PrivacyPolicy.jsx', label: 'Privacy Policy' },
];

const checkOnly = process.argv.includes('--check');

// DD.MM.YYYY, matching what the pages already showed.
function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function hashOf(file) {
    return createHash('sha256').update(readFileSync(resolve(ROOT, file))).digest('hex').slice(0, 16);
}

const current = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
const next = {};
const moved = [];

for (const doc of DOCS) {
    const hash = hashOf(doc.file);
    const prev = current[doc.key];
    if (prev && prev.hash === hash) {
        next[doc.key] = prev;
    } else {
        moved.push(doc.label);
        next[doc.key] = { date: today(), hash };
    }
}

if (!moved.length) {
    if (!checkOnly) console.log('stamp-legal: no legal content changed');
    process.exit(0);
}

if (checkOnly) {
    // A warning, not a failure: shipping a policy with a slightly old date is
    // a great deal better than refusing to deploy the site over one.
    console.warn(`stamp-legal: ${moved.join(' and ')} changed since the last stamp — run \`npm run stamp-legal\` and commit`);
    process.exit(0);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
console.log(`stamp-legal: dated ${moved.join(' and ')} ${today()}`);
