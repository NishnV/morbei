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

        -- The contact form gained a phone field; without this the number a
        -- customer types is accepted by the browser and dropped on the floor.
        --
        -- Must stay BELOW the CREATE above. IF NOT EXISTS guards the column,
        -- not the table, so against an empty database this errored — and since
        -- the whole of initDB is one multi-statement query, Postgres treats it
        -- as a single transaction and rolled back every other statement with
        -- it. No tables, boot fails, Railway restarts, repeat. Production only
        -- survived because the table predated the ALTER; a restore into a new
        -- database could not start at all.
        ALTER TABLE contact_submissions ADD COLUMN IF NOT EXISTS phone TEXT;

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

        -- A ₹1 order placed by the owner to exercise the live payment path.
        -- Real in every respect except the amount charged, so it must be
        -- excluded from revenue and conversion figures rather than deleted.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;

        -- When the "your order has shipped" email went out. Shopify does not
        -- tell us when an order is fulfilled, so a sweep looks for newly
        -- fulfilled orders; this column is what stops it sending twice.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS shipped_email_at TIMESTAMPTZ;

        -- Set when Shopify answers 404 for this order's id: it was deleted
        -- there and will not come back. A definitive answer worth keeping, so
        -- the dashboard can stop offering actions that can never succeed.
        -- Says nothing about whether the sale was real — that is is_test.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS shopify_order_missing_at TIMESTAMPTZ;

        -- Which guest session placed this order. A guest session is issued on
        -- an email alone, so it must only ever see what it bought itself;
        -- without this, anyone who knew an address that had checked out as a
        -- guest could ask for a session and read that customer's whole
        -- history. Null for orders placed by a signed-in customer, who is
        -- scoped by user_id as before.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS guest_session_id TEXT;
        CREATE INDEX IF NOT EXISTS idx_orders_guest_session ON orders (guest_session_id)
            WHERE guest_session_id IS NOT NULL;

        -- The guest order lookup and the returns lookup both match on an order
        -- number and a lower-cased email. Neither column was indexed for that:
        -- shopify_order_number had no index at all, and lower(email) cannot use
        -- the UNIQUE btree on users.email because the expression differs. Both
        -- endpoints seq-scanned two tables on every call — and both are
        -- callable without authentication. With statement_timeout at 10s that
        -- becomes a customer-visible timeout rather than a slow page.
        CREATE INDEX IF NOT EXISTS idx_orders_shopify_number ON orders (shopify_order_number);
        CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users (lower(email));

        -- The hourly shipped-notice sweep. The partial index above covers
        -- unsettled orders and deliberately excludes 'paid', which is exactly
        -- what this one scans.
        CREATE INDEX IF NOT EXISTS idx_orders_awaiting_ship_email ON orders (created_at)
            WHERE status = 'paid' AND shipped_email_at IS NULL;

        -- Cancellation claim, kept apart from the status column for the same
        -- reason claimed_at is: overloading status as a mutex means a process
        -- that dies mid-cancel leaves the row in a state no transition
        -- accepts, and nothing can release it.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_claimed_at TIMESTAMPTZ;

        -- A free replacement raised for an exchange. The parent is kept so
        -- the two can be told apart in reporting — a replacement is not a
        -- second sale.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS replacement_for_order_id INTEGER;

        -- Where THIS order's mail goes, when that is not the account's
        -- address. Null for almost every order, and null means "use the
        -- account", so nothing changes for a row that never needed it.
        --
        -- It exists because a customer mistyped her address at checkout and
        -- every message for her order went nowhere. The address could not be
        -- corrected without editing the users row, which is her login
        -- identity: it could collide with a real account holding the correct
        -- address, it would rewrite every other order she had placed, and a
        -- later Shopify sign-in would upsert it straight back. Where an
        -- order's mail goes is a fact about the order, not about the account.
        ALTER TABLE orders ADD COLUMN IF NOT EXISTS email TEXT;

        -- When our own welcome email went out, and the claim that stops it
        -- going twice.
        --
        -- Backfilled below for everyone who already has a real account,
        -- because they have already had Shopify's version and a second
        -- welcome months later reads as a mistake. Guest rows are left NULL
        -- on purpose: a guest has never had an account, so when they make
        -- one, that is a genuine first welcome.
        -- Guarded on the column not existing, so the backfill runs exactly
        -- once. Written as ADD COLUMN IF NOT EXISTS plus a plain UPDATE, it
        -- would re-run on every boot — and a customer who signed up minutes
        -- before a deploy would be marked welcomed by the next restart and
        -- never receive the email at all.
        DO $do$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                 WHERE table_schema = current_schema()
                   AND table_name = 'users' AND column_name = 'welcomed_at'
            ) THEN
                ALTER TABLE users ADD COLUMN welcomed_at TIMESTAMPTZ;
                UPDATE users SET welcomed_at = created_at WHERE password <> '!guest';
            END IF;
        END
        $do$;

        -- One live verification code per address.
        --
        -- The code is stored hashed. A six-digit code is guessable in a
        -- million tries, so what protects it is the attempt counter and the
        -- expiry, not its length — but a database that spills must not hand
        -- out working codes on top of everything else.
        --
        -- The counters live here rather than in memory because the server
        -- restarts on every deploy, and a rate limit that forgets itself on
        -- deploy is not a rate limit.
        CREATE TABLE IF NOT EXISTS email_codes (
            email TEXT PRIMARY KEY,
            code_hash TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            sent_count INTEGER NOT NULL DEFAULT 1,
            last_sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            window_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

        -- Addresses that have proved they can receive mail.
        --
        -- Kept so a returning customer verifies once and never again, which
        -- is the whole reason this is tolerable at checkout. It is a
        -- deliverability record, not an authentication one: it says mail sent
        -- here arrives, and nothing about who is typing it. Guest sessions
        -- stay scoped to the session that created them for exactly that
        -- reason — see signToken.
        --
        -- Not seeded from past orders on purpose. The address that caused all
        -- this sits on a paid order, so seeding from paid orders would
        -- whitelist precisely the one that never worked.
        CREATE TABLE IF NOT EXISTS verified_emails (
            email TEXT PRIMARY KEY,
            verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );

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

        -- Getting the item back is the step the system could not see. A return
        -- sat at 'approved' from the moment it was waved through until it was
        -- refunded, whether the parcel was in transit, on a shelf, or still in
        -- the customer's flat — and the refund button was live the whole time.
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_carrier TEXT;
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS return_awb TEXT;
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;

        -- Claims for the two operations that call an external API and then
        -- write the result. Status used to carry these as 'refunding' and
        -- 'exchanging', which meant a deploy or a timeout between the claim
        -- and the final update stranded the row forever: no transition
        -- accepted either value and nothing swept them. Holding the claim in
        -- its own column lets the status stay honest and lets a stale claim
        -- be released by age.
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_claimed_at TIMESTAMPTZ;
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS exchange_claimed_at TIMESTAMPTZ;

        -- What Razorpay called the refund. It was returned to the browser and
        -- then discarded, so reconciling a disputed refund meant going
        -- through Razorpay's dashboard by hand.
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_id TEXT;
        -- And for how much. Without it there is no way to know what remains
        -- refundable on an order, so the amount could only be compared against
        -- the whole capture — which refused outright whenever a line was worth
        -- more than was taken, as on a one-rupee test order.
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_amount_paise BIGINT;

        -- Set when the piece comes back and is sent on again because it
        -- failed inspection — worn, no tags, or not the item claimed.
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS inspection_note TEXT;

        -- Whether the piece went back into Shopify's inventory. Null means
        -- nobody has decided yet; false is a deliberate "do not restock".
        ALTER TABLE returns ADD COLUMN IF NOT EXISTS restocked_at TIMESTAMPTZ;

        CREATE INDEX IF NOT EXISTS idx_returns_status_created
            ON returns (status, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_returns_order ON returns (order_id);

        -- One open request per item. A shopper pressing submit twice, or
        -- coming back a day later, must not create two refunds to approve.
        -- One request per item, ever, unless it was turned down. This used to
        -- cover only 'requested' and 'approved', so once a return reached
        -- 'refunded' the same item could be requested again and refunded a
        -- second time — the amount cap is per order line, not per refund
        -- already issued, so on a multi-line order it stayed inside the
        -- captured total and Razorpay would accept it. A rejected request may
        -- be raised again; everything else is settled.
        DROP INDEX IF EXISTS idx_returns_one_open_per_item;
        CREATE UNIQUE INDEX IF NOT EXISTS idx_returns_one_per_item
            ON returns (order_id, variant_id)
            WHERE status <> 'rejected';
    `);
}
