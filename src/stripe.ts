/**
 * Stripe helpers for the Glitchy integration.
 * Requires `stripe` as a peer dependency — pass your already-constructed client.
 */
import type Stripe from "stripe";

/**
 * Minimal cookie interface — compatible with Next.js `RequestCookies` (from
 * `next/headers`), `NextRequest.cookies`, and any `Map<string, string>`.
 */
export interface CookieJar {
    get(name: string): { value: string } | undefined;
}

/**
 * Build the Glitchy metadata object to spread into both `metadata` and
 * `subscription_data.metadata` when creating a Stripe checkout session.
 * Storing it on the subscription ensures renewal invoices still have the
 * original click tokens when you fire renewal postbacks.
 *
 * @example
 * const glitchyMeta = getGlitchyMetadataFromCookies(req.cookies);
 * await stripe.checkout.sessions.create({
 *     metadata: { userId, plan, ...glitchyMeta },
 *     subscription_data: { metadata: { userId, plan, ...glitchyMeta } },
 * });
 */
export function getGlitchyMetadataFromCookies(cookies: CookieJar) {
    return {
        glitchy_sub1: cookies.get("gc_sub1")?.value ?? "",
        glitchy_sub2: cookies.get("gc_sub2")?.value ?? "",
        glitchy_sub4: cookies.get("gc_sub4")?.value ?? "",
        // gc_sub1 fallback: visitors who landed before the tracker was deployed
        // may only have the click id stored in sub1.
        glitchy_transaction_id:
            cookies.get("gc_txid")?.value || cookies.get("gc_sub1")?.value || "",
    };
}

/**
 * Returns true if a Glitchy postback has already been sent for this invoice.
 * Always re-fetches from Stripe — the webhook payload predates any marker we wrote.
 * Returns false on error so the postback fires rather than being silently skipped.
 */
export async function glitchyAlreadyReported(
    stripe: Stripe,
    invoiceId: string,
): Promise<boolean> {
    try {
        const invoice = await stripe.invoices.retrieve(invoiceId);
        return Boolean(invoice.metadata?.glitchy_postback_sent);
    } catch (err) {
        console.error("Glitchy dedupe check failed, sending anyway:", err, { invoiceId });
        return false;
    }
}

/**
 * Stamps the invoice with a timestamp so duplicate webhook deliveries don't
 * fire a second postback. Call this after a successful fireGlitchyPostback.
 */
export async function markGlitchyReported(
    stripe: Stripe,
    invoiceId: string,
): Promise<void> {
    try {
        await stripe.invoices.update(invoiceId, {
            metadata: { glitchy_postback_sent: new Date().toISOString() },
        });
    } catch (err) {
        console.error("Failed to mark Glitchy postback as sent:", err, { invoiceId });
    }
}
