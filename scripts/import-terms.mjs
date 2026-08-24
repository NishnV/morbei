#!/usr/bin/env node
/**
 * Convert the Terms & Conditions source document into src/data/terms.json.
 *
 *   node scripts/import-terms.mjs [path/to/terms.txt]
 *
 * Run this when a new revision arrives rather than editing the JSON, and
 * never retype the clauses into JSX: a legal document transcribed by hand is
 * a legal document with typos in it, and the diff on the following revision
 * is unreadable.
 *
 * Structure is inferred from the headings the document already uses —
 * "A. GENERAL TERMS" for a group, "XIV. USER-GENERATED CONTENT" for a
 * section. Note the order of the two tests below: "I." and "C." are both a
 * single capital followed by a dot, so roman numerals have to be ruled in
 * before group letters are.
 *
 * It reports a word count against the source. That number is the check that
 * matters — it catches a clause silently dropped by a heading pattern that
 * did not match, which reading the output would not.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, process.argv[2] || 'terms.txt');
const OUT = resolve(ROOT, 'src/data/terms.json');

const SECTION = /^[IVXLivxl]+\.\s+\S/;
const GROUP = /^[A-Z]\.\s+[A-Z0-9&,'\- ]+$/;

// Heading misspellings in the source. Clause text is reproduced verbatim;
// these carry no legal content and would otherwise ship as visible errors.
const HEADING_FIXES = [[/INTODUCTION/i, 'INTRODUCTION'], [/ACTIVITES/i, 'ACTIVITIES']];
const fixHeading = (h) => HEADING_FIXES.reduce((s, [re, to]) => s.replace(re, to), h);

const raw = readFileSync(SRC, 'utf8');
const groups = [];
const skipped = [];
let group = null;
let section = null;

raw.split('\n').forEach((line, i) => {
    const s = line.trim();
    if (!s) return;
    // A lone punctuation mark is an artefact of the source document.
    if (s.length <= 2 && !/[a-z0-9]/i.test(s[0])) return skipped.push(`${i + 1}: ${s}`);

    if (SECTION.test(s)) {
        if (!group) groups.push((group = { title: null, sections: [] }));
        section = { title: fixHeading(s), paragraphs: [] };
        group.sections.push(section);
    } else if (GROUP.test(s)) {
        groups.push((group = { title: s, sections: [] }));
        section = null;
    } else if (section) {
        section.paragraphs.push(s);
    } else {
        skipped.push(`${i + 1}: ${s.slice(0, 60)}`);
    }
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(groups, null, 2) + '\n');

const words = (t) => (t.match(/\S+/g) || []).length;
const rendered = groups.flatMap((g) => [
    g.title || '',
    ...g.sections.flatMap((s) => [s.title, ...s.paragraphs]),
]).reduce((n, t) => n + words(t), 0);

const sections = groups.reduce((n, g) => n + g.sections.length, 0);
console.log(`import-terms: ${groups.length} groups, ${sections} sections`);
console.log(`import-terms: ${words(raw)} words in, ${rendered} rendered, ${words(raw) - rendered} dropped`);
if (skipped.length) console.log(`import-terms: skipped ${skipped.length} line(s): ${skipped.join('; ')}`);
