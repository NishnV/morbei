import React from 'react';
import './Terms.css';
import TERMS from '../data/terms.json';

/**
 * Terms & Conditions.
 *
 * The text lives in src/data/terms.json, converted from the source document
 * by scripts/import-terms.mjs, rather than being transcribed into JSX. A
 * legal document retyped by hand is a legal document with typos in it, and
 * the diff on the next revision would be unreadable. Regenerate rather than
 * edit clauses here.
 *
 * No "Last Updated" line: this document states its own effective date in its
 * closing sections, and two dates that can disagree are worse than one.
 */
const Terms = () => {
    return (
        <div className="tc-page">
            <div className="tc-header">
                <h1 className="tc-title">Terms &amp; Conditions</h1>
                <div className="tc-rule" />
            </div>

            {TERMS.map((group, gi) => (
                <React.Fragment key={group.title || gi}>
                    {group.title && <h2 className="tc-group-title">{group.title}</h2>}
                    {group.sections.map((section, si) => (
                        <section className="tc-section" key={`${gi}-${si}-${section.title}`}>
                            <h3 className="tc-section-title">{section.title}</h3>
                            {section.paragraphs.map((para, pi) => (
                                <p className="tc-body" key={pi}>{para}</p>
                            ))}
                        </section>
                    ))}
                </React.Fragment>
            ))}
        </div>
    );
};

export default Terms;
