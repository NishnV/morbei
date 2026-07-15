import pg from 'pg';

const { Pool } = pg;

// Railway's private-network DATABASE_URL needs no SSL; public proxy URLs do.
const connectionString = process.env.DATABASE_URL;
const needsSsl = /sslmode=require|proxy\.rlwy\.net|supabase\.co/.test(connectionString || '');

export const pool = new Pool({
    connectionString,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: 10,
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
