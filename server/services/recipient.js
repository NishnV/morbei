/**
 * Who an order's mail actually goes to.
 *
 * Every notice — confirmation, dispatch, delivery, returns — addressed the
 * account. That was fine until a customer mistyped her address at checkout:
 * the order was paid, the address was dead, and nothing could be done about
 * it without editing her users row, which is her login identity. Doing that
 * risks colliding with a real account that holds the correct address,
 * rewrites every other order she has placed, and gets undone the next time
 * she signs in through Shopify, because that upserts by email.
 *
 * So an order may carry its own address, and it wins when it is set. Set it
 * through the admin control, which checks the domain can receive mail before
 * accepting it and tells Shopify as well.
 *
 * Used everywhere a user row is loaded in order to send something about an
 * order. A send path that loads the user directly and skips this will post
 * to the wrong address, which is exactly the bug this exists to end.
 */
export function recipientFor(user, order) {
    if (!user) return user;
    if (!order?.email) return user;
    // A copy: the caller's user row is also used for the name, and nothing
    // downstream should see a mutated record it did not ask for.
    return { ...user, email: order.email };
}
