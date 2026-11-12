/**
 * The business's own details, in one place.
 *
 * These were spread across three files and had already drifted: the registered
 * office appeared as "Gerugambakkam, Chennai 600128" in two places and
 * "Kancheepuram, Tamil Nadu 600122" in a third. For an address a customer uses
 * to post a return — or to serve a legal notice — one of those was wrong, and
 * nothing would ever have reconciled them.
 *
 * The backend keeps its own copy in server/services/email.js (RETURN_ADDRESS)
 * because it cannot import from the frontend bundle; the two are called out
 * in each other's comments.
 *
 * NOTE: src/data/terms.json still carries the Kancheepuram version in its
 * prose and has deliberately not been edited here. It is a legal document,
 * the two versions disagree, and which is correct is a question for whoever
 * filed the LLP registration — not something to resolve by picking one.
 */

export const BUSINESS = {
    legalName: 'MORBEI LLP',
    gstin: '33ACHFM2342Q1ZY',

    // Where a customer posts a return, and the address shown on the site.
    registeredOffice: {
        lines: [
            'MORBEI LLP',
            'No. 248, B Block, First Floor, F2',
            'Vigneshwara Nagar, Gerugambakkam',
        ],
        city: 'Chennai',
        state: 'Tamil Nadu',
        pin: '600128',
        country: 'India',
    },

    support: {
        email: 'info@morbei.com',
        phone: '+91 9952228533',
        // tel: href form — no spaces.
        phoneHref: '+919952228533',
        hours: 'Monday to Saturday, 10am – 6pm IST',
    },

    /**
     * Consumer Protection (E-Commerce) Rules 2020 require an e-commerce entity
     * to appoint a Grievance Officer and display their name, contact details
     * and designation, with an acknowledgement within 48 hours and redressal
     * within one month. None of that appeared anywhere on the site.
     *
     * The DPDP Act expects a published contact point for data-rights requests
     * too; the same person can hold both unless the business grows enough to
     * separate them.
     *
     * REPLACE `name` with the real person. A placeholder here is worse than
     * nothing, because it is a published commitment nobody is answering.
     */
    grievanceOfficer: {
        name: null,
        designation: 'Grievance Officer',
        email: 'info@morbei.com',
        phone: '+91 9952228533',
        phoneHref: '+919952228533',
        acknowledgeWithin: '48 hours',
        resolveWithin: 'one month',
    },
};

/** The registered office as a single line, for compact places. */
export function addressOneLine() {
    const a = BUSINESS.registeredOffice;
    return [...a.lines.slice(1), a.city, `${a.state} ${a.pin}`, a.country].join(', ');
}

/** The registered office as lines, for a block that can breathe. */
export function addressLines() {
    const a = BUSINESS.registeredOffice;
    return [...a.lines, `${a.city} ${a.pin}`, `${a.state}, ${a.country}`];
}
