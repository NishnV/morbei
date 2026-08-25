import React, { useEffect, useMemo, useState } from 'react';
import DOMPurify from 'dompurify';
import { parseMeasurementTable, rowToCm } from '../utils/measurementTable';
import './SizeGuide.css';

/**
 * Size guide dialog.
 *
 * The "Size Guide" button on every product page had no click handler, and the
 * `size_guide` metafield was parsed in normalizeProduct and never read. For a
 * fashion store that combination drives returns — the customer either guesses
 * or leaves.
 *
 * Uses the product's own `size_guide` metafield when the merchant has filled
 * one in; otherwise falls back to a standard chart so the button is never dead.
 *
 * Two panels, because they answer different questions and the answers differ
 * per garment:
 *
 *   SIZE GUIDE — the brand's body measurements, identical on every product.
 *     Shown first, and what the dialog opens on.
 *   PRODUCT MEASUREMENTS — this garment's own cut, from the product's
 *     custom.product_measurement metafield. Per product, so the tab only
 *     appears when that product has one.
 *
 * The tab row is only drawn when there is a product table to switch to;
 * otherwise this stays the single-panel dialog it was.
 */

// Body measurements for selecting size + garment length column.
// LENGTH values are approximate garment lengths — update if MORBEI's
// sizing runs longer or shorter than these defaults.
const CHARTS = {
    top: {
        headers: ['SIZE', 'BUST', 'WAIST', 'LENGTH'],
        rowsIn: [
            ['XXS', '30–31', '23–24', '22'],
            ['XS',  '32–33', '25–26', '22.5'],
            ['S',   '34–35', '27–28', '23'],
            ['M',   '36–37', '29–30', '23.5'],
            ['L',   '38–40', '31–33', '24'],
            ['XL',  '41–43', '34–36', '24.5'],
        ],
        rowsCm: [
            ['XXS', '76–79',   '58–61',  '56'],
            ['XS',  '81–84',   '63–66',  '57'],
            ['S',   '86–89',   '68–71',  '58'],
            ['M',   '91–94',   '74–76',  '60'],
            ['L',   '97–102',  '79–84',  '61'],
            ['XL',  '104–109', '86–91',  '62'],
        ],
        notes: [
            { label: 'BUST',   desc: 'around the fullest part, tape level and not pulled tight.' },
            { label: 'WAIST',  desc: 'around the narrowest part of the natural waist.' },
            { label: 'LENGTH', desc: 'shoulder seam to hem (garment measurement).' },
        ],
    },
    bottom: {
        headers: ['SIZE', 'WAIST', 'HIP', 'LENGTH'],
        rowsIn: [
            ['XXS', '23–24', '33–34', '36'],
            ['XS',  '25–26', '35–36', '36.5'],
            ['S',   '27–28', '37–38', '37'],
            ['M',   '29–30', '39–40', '37.5'],
            ['L',   '31–33', '41–43', '38'],
            ['XL',  '34–36', '44–46', '38.5'],
        ],
        rowsCm: [
            ['XXS', '58–61',  '84–86',   '91'],
            ['XS',  '63–66',  '89–91',   '93'],
            ['S',   '68–71',  '94–97',   '94'],
            ['M',   '74–76',  '99–102',  '95'],
            ['L',   '79–84',  '104–109', '97'],
            ['XL',  '86–91',  '112–117', '98'],
        ],
        notes: [
            { label: 'WAIST',  desc: 'around the narrowest part of the natural waist.' },
            { label: 'HIP',    desc: 'around the fullest part, roughly 20cm below the waist.' },
            { label: 'LENGTH', desc: 'waist to hem (garment measurement).' },
        ],
    },
    dress: {
        headers: ['SIZE', 'BUST', 'WAIST', 'HIP', 'LENGTH'],
        rowsIn: [
            ['XXS', '30–31', '23–24', '33–34', '44'],
            ['XS',  '32–33', '25–26', '35–36', '44.5'],
            ['S',   '34–35', '27–28', '37–38', '45'],
            ['M',   '36–37', '29–30', '39–40', '45.5'],
            ['L',   '38–40', '31–33', '41–43', '46'],
            ['XL',  '41–43', '34–36', '44–46', '46.5'],
        ],
        rowsCm: [
            ['XXS', '76–79',   '58–61',  '84–86',   '112'],
            ['XS',  '81–84',   '63–66',  '89–91',   '113'],
            ['S',   '86–89',   '68–71',  '94–97',   '114'],
            ['M',   '91–94',   '74–76',  '99–102',  '115'],
            ['L',   '97–102',  '79–84',  '104–109', '117'],
            ['XL',  '104–109', '86–91',  '112–117', '118'],
        ],
        notes: [
            { label: 'BUST',   desc: 'around the fullest part, tape level and not pulled tight.' },
            { label: 'WAIST',  desc: 'around the narrowest part of the natural waist.' },
            { label: 'HIP',    desc: 'around the fullest part, roughly 20cm below the waist.' },
            { label: 'LENGTH', desc: 'shoulder seam to hem (garment measurement).' },
        ],
    },
    default: {
        headers: ['SIZE', 'BUST', 'WAIST', 'HIP'],
        rowsIn: [
            ['XXS', '30–31', '23–24', '33–34'],
            ['XS',  '32–33', '25–26', '35–36'],
            ['S',   '34–35', '27–28', '37–38'],
            ['M',   '36–37', '29–30', '39–40'],
            ['L',   '38–40', '31–33', '41–43'],
            ['XL',  '41–43', '34–36', '44–46'],
        ],
        rowsCm: [
            ['XXS', '76–79',   '58–61',  '84–86'],
            ['XS',  '81–84',   '63–66',  '89–91'],
            ['S',   '86–89',   '68–71',  '94–97'],
            ['M',   '91–94',   '74–76',  '99–102'],
            ['L',   '97–102',  '79–84',  '104–109'],
            ['XL',  '104–109', '86–91',  '112–117'],
        ],
        notes: [
            { label: 'BUST',  desc: 'around the fullest part, tape level and not pulled tight.' },
            { label: 'WAIST', desc: 'around the narrowest part of the natural waist.' },
            { label: 'HIP',   desc: 'around the fullest part, roughly 20cm below the waist.' },
        ],
    },
};

function resolveChart(productType) {
    const t = (productType || '').toLowerCase();
    if (t.includes('top') || t.includes('blouse') || t.includes('shirt')) return CHARTS.top;
    if (t.includes('bottom') || t.includes('pant') || t.includes('trouser') || t.includes('skirt')) return CHARTS.bottom;
    if (t.includes('dress')) return CHARTS.dress;
    return CHARTS.default;
}

const SizeGuide = ({ open, onClose, sizeGuideHtml, productName, measurementsText, productType }) => {
    const [unit, setUnit] = useState('in');
    const [tab, setTab] = useState('guide');
    const chart = resolveChart(productType);

    // Always opens on the size guide — the body measurements are the question
    // a shopper arrives with, and this garment's own cut is the follow-up.
    // Reset during render rather than in an effect: an effect would paint the
    // tab they left on and then swap it, and it re-renders the tree twice.
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setTab('guide');
    }

    const productTable = useMemo(() => parseMeasurementTable(measurementsText), [measurementsText]);
    const hasProductPanel = Boolean(productTable || measurementsText);

    useEffect(() => {
        if (!open) return;
        const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        // Stop the page scrolling behind the dialog.
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            window.removeEventListener('keydown', onKey);
            document.body.style.overflow = prev;
        };
    }, [open, onClose]);

    if (!open) return null;

    // A product panel was asked for but this product has none — show the guide.
    const activeTab = hasProductPanel ? tab : 'guide';
    const rows = unit === 'in' ? chart.rowsIn : chart.rowsCm;
    const productRows = productTable
        ? (unit === 'in' ? productTable.rows : productTable.rows.map(rowToCm))
        : [];

    const unitToggle = (
        <div className="sg-units" role="group" aria-label="Measurement unit">
            <button
                className={`sg-unit${unit === 'in' ? ' active' : ''}`}
                onClick={() => setUnit('in')}
                aria-pressed={unit === 'in'}
            >INCHES</button>
            <button
                className={`sg-unit${unit === 'cm' ? ' active' : ''}`}
                onClick={() => setUnit('cm')}
                aria-pressed={unit === 'cm'}
            >CM</button>
        </div>
    );

    return (
        <div className="sg-backdrop" onClick={onClose}>
            <div className="sg-modal" role="dialog" aria-modal="true" aria-label="Size guide" onClick={(e) => e.stopPropagation()}>
                <button className="sg-close" onClick={onClose} aria-label="Close size guide">
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                        <line x1="1" y1="1" x2="15" y2="15" />
                        <line x1="15" y1="1" x2="1" y2="15" />
                    </svg>
                </button>

                <h2 className="sg-title">SIZE GUIDE</h2>
                {productName && <p className="sg-product">{productName}</p>}

                {hasProductPanel && (
                    <div className="sg-tabs" role="tablist" aria-label="Measurement view">
                        <button
                            role="tab"
                            className={`sg-tab${activeTab === 'guide' ? ' active' : ''}`}
                            aria-selected={activeTab === 'guide'}
                            onClick={() => setTab('guide')}
                        >SIZE GUIDE</button>
                        <button
                            role="tab"
                            className={`sg-tab${activeTab === 'product' ? ' active' : ''}`}
                            aria-selected={activeTab === 'product'}
                            onClick={() => setTab('product')}
                        >PRODUCT MEASUREMENTS</button>
                    </div>
                )}

                {activeTab === 'product' ? (
                    <>
                        {/* Only offer the unit switch when there are numbers to convert.
                            A product still on the old single-line value has nothing to
                            toggle, so the control would be a lie. */}
                        {productTable && unitToggle}

                        {productTable ? (
                            <div className="sg-table-wrap">
                                <table className="sg-table">
                                    <thead>
                                        <tr>{productTable.headers.map((h, i) => <th key={i}>{h}</th>)}</tr>
                                    </thead>
                                    <tbody>
                                        {productRows.map((row, r) => (
                                            <tr key={r}>
                                                {row.map((cell, i) => (
                                                    i === 0 ? <th scope="row" key={i}>{cell}</th> : <td key={i}>{cell}</td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : (
                            // Not a table — render what the merchant typed.
                            <div className="sg-notes">
                                {String(measurementsText).split(/\n+/).map((line, i) => (
                                    <p key={i}>{line.trim()}</p>
                                ))}
                            </div>
                        )}

                        <div className="sg-notes">
                            {/* How to take each measurement, written per product — a top
                                explains BUST and WAIST, trousers LOW WAIST and HIP. They
                                arrive as the note lines of the same metafield, so they
                                change with the columns above them. */}
                            {productTable?.notes?.map((note, i) => {
                                // "BUST — around the fullest part" → bold the term.
                                const split = note.match(/^([^—–-]{1,24})\s*[—–-]\s*(.+)$/);
                                return split
                                    ? <p key={i}><strong>{split[1].trim()}</strong> — {split[2]}</p>
                                    : <p key={i}>{note}</p>;
                            })}
                            <p className="sg-note-muted">
                                These are the finished garment's measurements. For body
                                measurements and how to take them, see SIZE GUIDE.
                            </p>
                        </div>
                    </>
                ) : sizeGuideHtml ? (
                    // Merchant-authored, same sanitisation as the product description.
                    <div
                        className="sg-custom"
                        dangerouslySetInnerHTML={{
                            __html: DOMPurify.sanitize(sizeGuideHtml, {
                                ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li',
                                    'table', 'thead', 'tbody', 'tr', 'th', 'td', 'h3', 'h4', 'span'],
                                ALLOWED_ATTR: ['colspan', 'rowspan'],
                            }),
                        }}
                    />
                ) : (
                    <>
                        {unitToggle}

                        <div className="sg-table-wrap">
                            <table className="sg-table">
                                <thead>
                                    <tr>{chart.headers.map(h => <th key={h}>{h}</th>)}</tr>
                                </thead>
                                <tbody>
                                    {rows.map(row => (
                                        <tr key={row[0]}>
                                            {row.map((cell, i) => (
                                                i === 0 ? <th scope="row" key={i}>{cell}</th> : <td key={i}>{cell}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        <div className="sg-notes">
                            {chart.notes.map(({ label, desc }) => (
                                <p key={label}><strong>{label}</strong> — {desc}</p>
                            ))}
                            <p className="sg-note-muted">
                                Body measurements in inches unless stated. Between two sizes, size up
                                for a relaxed fit. See PRODUCT MEASUREMENTS for this garment's cut.
                            </p>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default SizeGuide;
