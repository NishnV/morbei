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
    `);
}
