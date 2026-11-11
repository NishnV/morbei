import pg from 'pg';

const { Pool } = pg;

// Railway's private-network DATABASE_URL needs no SSL; public proxy URLs do.
const connectionString = process.env.DATABASE_URL;
const needsSsl = /sslmode=require|proxy\.rlwy\.net|supabase\.co/.test(connectionString || '');

export const pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: 10,
    // Without timeouts a single hung query holds one of only ten connections
    // indefinitely; enough of them and the whole API stops responding while
    // looking perfectly healthy.
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    query_timeout: 10000,
});

// Without this, an error on an idle client (e.g. the DB restarting)
// is an unhandled 'error' event and crashes the whole process.
pool.on('error', (err) => {
    console.error('Unexpected error on idle Postgres client:', err.message);
});

/** Return the first row, or undefined. */
export async function get(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows[0];
}

/** Return all rows. */
export async function all(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows;
}

/** Run a statement; returns { rowCount, rows } (use RETURNING for inserted ids). */
export async function run(text, params = []) {
    return pool.query(text, params);
}

/** Run a set of statements inside a transaction. */
export async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}

export async function initDB() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            first_name TEXT NOT NULL DEFAULT '',
            last_name TEXT NOT NULL DEFAULT '',
            phone TEXT DEFAULT '',
            created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            razorpay_order_id TEXT,
            razorpay_payment_id TEXT,
            shopify_order_id TEXT,
            shiprocket_order_id TEXT,
            shiprocket_awb TEXT,
            status TEXT DEFAULT 'pending',
            total_amount BIGINT NOT NULL,
            shipping_method TEXT DEFAULT 'standard',
            shipping_address TEXT,
            items TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
        CREATE INDEX IF NOT EXISTS idx_orders_razorpay ON orders (razorpay_order_id);

        -- The reconciler sweeps unsettled orders hourly; without this it table-scans.
        CREATE INDEX IF NOT EXISTS idx_orders_unsettled ON orders (created_at)
            WHERE status IN ('pending', 'processing');

        -- Records the Razorpay refund issued when an order is cancelled.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS refund_id TEXT;

        -- When fulfillPaidOrder last claimed this order (status → 'processing').
        -- Staleness of a claim MUST be measured from this, never from created_at:
        -- a customer can spend 10 minutes in the Razorpay flow, so created_at
        -- says nothing about whether a claim is still being worked on. NULL on
        -- rows claimed before this column existed — treated as "don't fast-release".
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ;

        -- Shopify's sequential, customer-facing order number (#1001, #1002…).
        -- shopify_order_id is the internal 13-digit id — never show that to customers.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_number BIGINT;

        -- Bumping this invalidates every JWT already issued to the user.
        -- Without it, logout only clears the client's copy and the token stays
        -- valid server-side for its full lifetime.
        ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;

        -- The contact form gained a phone field; without this the number a
        -- customer types is accepted by the browser and dropped on the floor.
        ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS phone TEXT;

        CREATE TABLE IF NOT EXISTS contact_submissions (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            name TEXT, email TEXT, subject TEXT, message TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS newsletter (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            email TEXT UNIQUE NOT NULL,
            created_at TIMESTAMPTZ DEFAULT now()
        );
        -- Consent provenance. Under the DPDP Act (and GDPR for any EU
        -- subscriber) you have to be able to show when and how consent was
        -- given, and honour its withdrawal — none of which the bare email
        -- column supported.
        ALTER TABLE newsletter ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'footer';
        ALTER TABLE newsletter ADD COLUMN IF NOT EXISTS consent_ip TEXT;
        ALTER TABLE newsletter ADD COLUMN IF NOT EXISTS unsubscribed_at TIMESTAMPTZ;

        CREATE TABLE IF NOT EXISTS wishlist (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id),
            product_id TEXT NOT NULL,
            variant_id TEXT,
            product_data TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            UNIQUE(user_id, product_id)
        );

        -- Funnel events, first-party. The same events go to Meta, but a large
        -- share of those never arrive: Safari's tracking prevention and ad
        -- blockers drop requests to facebook.com, and the gap is invisible
        -- from inside Events Manager. These rows come to our own domain, so
        -- the dashboard can show what actually happened.
        --
        -- No IP address and no user agent. visitor_id and session_id are
        -- random values the browser generates, which is all the funnel needs,
        -- and keeps this out of personal-data territory under the DPDP Act.
        CREATE TABLE IF NOT EXISTS site_events (
            id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            event TEXT NOT NULL,
            path TEXT,
            visitor_id TEXT,
            session_id TEXT,
            product_handle TEXT,
            value_rupees NUMERIC(12, 2),
            currency TEXT,
            event_id TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
        );

        -- Every dashboard query is "this event, over this window".
        CREATE INDEX IF NOT EXISTS idx_site_events_event_created
            ON site_events (event, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_site_events_created
            ON site_events (created_at DESC);

        -- When the order actually reached the customer, which is what the
        -- seven-day return window runs from. Shopify will not simply tell us:
        -- fulfillment_status means shipped, and the delivered state lives on
        -- fulfillments[].shipment_status, which stays null unless a tracking
        -- number from a carrier Shopify can poll was attached. So this is
        -- filled from that status where it exists and set by hand otherwise.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

        -- Return and exchange requests.
        --
        -- order_id is nullable on purpose. The form is filled in by order
        -- number and email without signing in, and a request is worth keeping
        -- even if it cannot be matched to a row — someone typing their order
        -- number wrong is a customer to help, not an error to discard.
        CREATE TABLE IF NOT EXISTS returns (
            id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            order_id INTEGER REFERENCES orders(id),
            shopify_order_number BIGINT,
            email TEXT NOT NULL,
            full_name TEXT,
            phone TEXT,
            -- One row per item: a shopper returning one of three things is the
            -- normal case, so the request is per item rather than per order.
            variant_id TEXT,
            product_title TEXT,
            reasons TEXT,            -- JSON array, from a fixed list
            details TEXT,
            resolution TEXT,         -- refund | exchange_size | exchange_product
            comments TEXT,
            media TEXT,              -- JSON array of uploaded photo/video URLs
            declaration BOOLEAN NOT NULL DEFAULT false,
            status TEXT NOT NULL DEFAULT 'requested',
            admin_note TEXT,
            created_at TIMESTAMPTZ DEFAULT now(),
            updated_at TIMESTAMPTZ DEFAULT now()
        );

        -- Which size they want back, for an exchange. The form asks only when
        -- the shopper picks an exchange, so it is null on a refund.
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS exchange_size TEXT;
        -- The replacement order raised in Shopify, once one exists.
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS replacement_order_number BIGINT;

        CREATE INDEX IF NOT EXISTS idx_returns_status_created
            ON returns (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_returns_order ON returns (order_id);

        -- One open request per item. A shopper pressing submit twice, or
        -- coming back a day later, must not create two refunds to approve.
        CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_one_open_per_item
            ON returns (order_id, variant_id)
            WHERE status IN ('requested', 'approved');
    `);
}
