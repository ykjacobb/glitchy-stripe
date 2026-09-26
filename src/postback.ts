// Glitchy (gtrx.org) affiliate network — conversion postback.
//
// Traffic flow:
//   rdr.gtrx.org/aff_c?offer_id=<offer>&aff_id=<aff>  →  yoursite.com/?<tokens>
//   GlitchyTracker persists the tokens into 30-day cookies
//   → checkout copies them into Stripe session metadata
//   → Stripe webhook fires the aff_lsr conversion postback below.

const DEFAULT_POSTBACK_URL = "https://glitchy.go2cloud.org/aff_lsr";

const POSTBACK_URL = process.env.GLITCHY_POSTBACK_URL?.trim() || DEFAULT_POSTBACK_URL;

export const GLITCHY_OFFER_ID = process.env.GLITCHY_OFFER_ID?.trim() ?? "";

export type GlitchyPostbackInput = {
    /** Glitchy's click transaction id. Required — this is what attributes the sale. */
    transactionId: string;
    /** Gross order total in the offer's currency (USD for most offers). Glitchy applies the revshare split on their side. */
    saleAmount: string;
    /** Logging context only — not sent to the network. */
    affiliateId?: string;
    offerId?: string;
    source?: string;
    /** true when fired by an admin test endpoint rather than a real checkout. */
    isTest?: boolean;
};

export type GlitchyPostbackResult = {
    sent: boolean;
    skippedReason?: "no_transaction_id" | "missing_security_key" | "http_error" | "network_error";
    status?: number;
    responseBody?: string;
    /** Postback URL with the security token redacted — safe to log or return to clients. */
    url?: string;
};

/**
 * Fire the Glitchy conversion postback.
 *
 * Never throws — a tracking failure must not break checkout processing.
 *
 * Required env: GLITCHY_SECURITY_KEY
 * Optional env: GLITCHY_POSTBACK_URL (defaults to https://glitchy.go2cloud.org/aff_lsr)
 */
export async function fireGlitchyPostback(
    input: GlitchyPostbackInput,
): Promise<GlitchyPostbackResult> {
    const tag = input.isTest ? "Glitchy postback [TEST]" : "Glitchy postback";
    const ctx = {
        affiliateId: input.affiliateId || "(none)",
        offerId: input.offerId || GLITCHY_OFFER_ID || "(none)",
        source: input.source || "(none)",
    };

    const transactionId = input.transactionId?.trim() ?? "";
    if (!transactionId) {
        // Without the click transaction id there is nothing to attribute the sale
        // to. An organic sale (no affiliate link) lands here and is expected.
        console.warn(`${tag} skipped: no Glitchy transaction id`, ctx);
        return { sent: false, skippedReason: "no_transaction_id" };
    }

    const token = process.env.GLITCHY_SECURITY_KEY?.trim();
    if (!token) {
        console.error(`${tag} skipped: GLITCHY_SECURITY_KEY is not set`);
        return { sent: false, skippedReason: "missing_security_key" };
    }

    const url = new URL(POSTBACK_URL);
    url.searchParams.set("transaction_id", transactionId);
    url.searchParams.set("amount", input.saleAmount);
    url.searchParams.set("security_token", token);

    // Build the loggable URL separately rather than string-replacing the token
    // out of the real one — URLSearchParams escapes characters differently, so
    // a replace can silently miss and leak the token.
    const safe = new URL(url.toString());
    safe.searchParams.set("security_token", "[redacted]");
    const safeUrl = safe.toString();

    try {
        const res = await fetch(url.toString());
        const body = (await res.text().catch(() => "")).slice(0, 1000);
        if (res.ok) {
            console.log(`${tag} sent:`, { status: res.status, url: safeUrl, body, ...ctx });
        } else {
            console.error(`${tag} non-OK:`, res.status, body, safeUrl, ctx);
        }
        return {
            sent: res.ok,
            status: res.status,
            responseBody: body,
            url: safeUrl,
            skippedReason: res.ok ? undefined : "http_error",
        };
    } catch (err) {
        console.error(`${tag} failed:`, err, safeUrl, ctx);
        return {
            sent: false,
            skippedReason: "network_error",
            responseBody: String(err),
            url: safeUrl,
        };
    }
}
