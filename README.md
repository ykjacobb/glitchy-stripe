# glitchy-stripe

Glitchy (gtrx.org) affiliate network integration for Stripe.

Handles the full postback flow: capturing click tokens on landing, forwarding them through the Stripe checkout session, and firing (deduplicated) conversion postbacks on first payment and every renewal.

---

## Install

```bash
npm install glitchy-stripe
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `GLITCHY_SECURITY_KEY` | **Yes** | Your postback security token from the Glitchy network dashboard |
| `GLITCHY_OFFER_ID` | No | Your offer ID — used for admin display and tracking link construction only, not sent in postbacks |
| `GLITCHY_POSTBACK_URL` | No | Override the postback endpoint (default: `https://glitchy.go2cloud.org/aff_lsr`) |

---

## Usage

### 1. Capture click tokens on landing

Add `<GlitchyTracker />` to your root layout. It runs client-side, renders nothing, and writes the Glitchy click tokens into 30-day cookies on every page load.

```tsx
// app/layout.tsx
import { GlitchyTracker } from "glitchy-stripe";

export default function RootLayout({ children }) {
    return (
        <html>
            <body>
                <GlitchyTracker />
                {children}
            </body>
        </html>
    );
}
```

### 2. Forward tokens through the Stripe checkout session

In your checkout API route, read the cookies and spread the metadata onto both the session and the subscription so renewal invoices also carry the click tokens.

```ts
// app/api/stripe/checkout/route.ts
import { getGlitchyMetadataFromCookies } from "glitchy-stripe";

const glitchyMeta = getGlitchyMetadataFromCookies(req.cookies);

await stripe.checkout.sessions.create({
    // ...
    metadata: { userId, plan, ...glitchyMeta },
    subscription_data: {
        metadata: { userId, plan, ...glitchyMeta },
    },
});
```

### 3. Fire the postback from your Stripe webhook

On `checkout.session.completed` (first payment) and `invoice.payment_succeeded` with `billing_reason === "subscription_cycle"` (renewals):

```ts
// app/api/stripe/webhook/route.ts
import {
    fireGlitchyPostback,
    glitchyAlreadyReported,
    markGlitchyReported,
} from "glitchy-stripe";

// You define the sale amounts for your offer — Glitchy has no currency field,
// so always send USD regardless of what Stripe charged.
const SALE_AMOUNTS_USD: Record<string, number> = {
    monthly: 22.85,
    weekly: 8.88,
};

async function reportToGlitchy(
    stripe: Stripe,
    invoiceId: string,
    metadata: Record<string, string>,
    plan: string,
) {
    const transactionId = metadata.glitchy_transaction_id ?? "";
    if (!transactionId) return; // organic sale, nothing to report

    if (await glitchyAlreadyReported(stripe, invoiceId)) return;

    const saleAmount = SALE_AMOUNTS_USD[plan];
    if (!saleAmount) return;

    const result = await fireGlitchyPostback({
        transactionId,
        saleAmount: saleAmount.toFixed(2),
        affiliateId: metadata.glitchy_sub1,
        offerId: metadata.glitchy_sub2,
        source: metadata.glitchy_sub4,
    });

    if (result.sent) await markGlitchyReported(stripe, invoiceId);
}
```

---

## How deduplication works

Stripe can deliver the same webhook event more than once. To prevent double-paying affiliates, `markGlitchyReported` stamps the Stripe invoice with `glitchy_postback_sent: <ISO timestamp>` after a successful postback. `glitchyAlreadyReported` always re-fetches the invoice from the Stripe API (not the webhook payload, which predates any marker we wrote) before firing.

---

## API

### `fireGlitchyPostback(input)`

Fires the HTTP conversion postback. Never throws.

```ts
type GlitchyPostbackInput = {
    transactionId: string;   // Glitchy's click transaction id
    saleAmount: string;      // gross total in USD, e.g. "22.85"
    affiliateId?: string;    // logging only
    offerId?: string;        // logging only
    source?: string;         // logging only
    isTest?: boolean;        // tags logs as [TEST]
};

type GlitchyPostbackResult = {
    sent: boolean;
    skippedReason?: "no_transaction_id" | "missing_security_key" | "http_error" | "network_error";
    status?: number;
    responseBody?: string;
    url?: string; // security token redacted
};
```

### `GlitchyTracker`

React client component. No props. Mount once in your root layout.

### `getGlitchyMetadataFromCookies(cookies)`

Reads the `gc_*` cookies set by `GlitchyTracker` and returns a flat object safe to spread into Stripe metadata. Accepts any object with a `.get(name)` method (Next.js `RequestCookies`, `NextRequest.cookies`, or a plain `Map`).

### `glitchyAlreadyReported(stripe, invoiceId)`

Returns `true` if the invoice has already been stamped. Pass your Stripe client instance.

### `markGlitchyReported(stripe, invoiceId)`

Stamps the invoice. Call after a successful `fireGlitchyPostback`. Pass your Stripe client instance.

### `GLITCHY_OFFER_ID`

The value of `process.env.GLITCHY_OFFER_ID`, or `""` if unset.
