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

The Glitchy postback has no currency field — it always expects USD. Use `convertSaleAmountToUSD` to convert Stripe's `amount_total` from whatever currency the customer paid in.

```ts
// app/api/stripe/webhook/route.ts
import {
    fireGlitchyPostback,
    convertSaleAmountToUSD,
    glitchyAlreadyReported,
    markGlitchyReported,
} from "glitchy-stripe";

// Build this once: 1 unit of each currency = X USD.
// Derive it from whatever FX table your app already has.
const USD_RATES: Record<string, number> = {
    usd: 1,
    gbp: 1.27,
    eur: 1.08,
    jpy: 0.0067,
    // ... add every currency your checkout supports
};

async function reportToGlitchy(
    stripe: Stripe,
    invoiceId: string,
    amountTotal: number,
    currency: string,
    metadata: Record<string, string>,
) {
    const transactionId = metadata.glitchy_transaction_id ?? "";
    if (!transactionId) return; // organic sale, nothing to report

    if (await glitchyAlreadyReported(stripe, invoiceId)) return;

    const result = await fireGlitchyPostback({
        transactionId,
        saleAmount: convertSaleAmountToUSD(amountTotal, currency, USD_RATES),
        affiliateId: metadata.glitchy_sub1,
        offerId: metadata.glitchy_sub2,
        source: metadata.glitchy_sub4,
    });

    if (result.sent) await markGlitchyReported(stripe, invoiceId);
}
```

---

## How currency conversion works

Glitchy's postback endpoint accepts no currency field — whatever number you send in `amount`, it reads as USD. `convertSaleAmountToUSD` handles two things:

1. **Zero-decimal currencies** — Stripe stores JPY, KRW, VND etc. as whole units (¥1328, not 132800). The function knows which currencies are zero-decimal and skips the ÷100 step for them.
2. **FX conversion** — multiplies the decimal amount by your provided rate to get USD.

You supply the `usdRates` map so the package has no opinion on exchange rates. If a currency isn't in your map, the function logs an error and returns `"0.00"` rather than throwing, so a missing rate never breaks checkout.

```ts
import { convertSaleAmountToUSD, STRIPE_ZERO_DECIMAL_CURRENCIES } from "glitchy-stripe";

// Stripe amount_total for a £17.99 charge is 1799 (pence)
convertSaleAmountToUSD(1799, "gbp", { gbp: 1.27 }); // → "22.85"

// Stripe amount_total for ¥1328 is 1328 (already in yen — zero-decimal)
convertSaleAmountToUSD(1328, "jpy", { jpy: 0.0067 }); // → "8.90"

// If you need to add currencies to the zero-decimal set:
convertSaleAmountToUSD(amount, currency, rates, new Set([...STRIPE_ZERO_DECIMAL_CURRENCIES, "myr"]));
```

---

## How deduplication works

Stripe can deliver the same webhook event more than once. To prevent double-paying affiliates, `markGlitchyReported` stamps the Stripe invoice with `glitchy_postback_sent: <ISO timestamp>` after a successful postback. `glitchyAlreadyReported` always re-fetches the invoice from the Stripe API (not the webhook payload, which predates any marker we wrote) before firing.

---

## API

### `convertSaleAmountToUSD(amountTotal, currency, usdRates, zeroDecimalCurrencies?)`

Converts a Stripe `amount_total` to a USD string for the postback.

| Param | Type | Description |
|---|---|---|
| `amountTotal` | `number` | Stripe's raw `amount_total` (smallest unit — cents for most, already in major units for zero-decimal) |
| `currency` | `string` | ISO 4217 code, case-insensitive (`"gbp"`, `"JPY"`, `"usd"`) |
| `usdRates` | `Record<string, number>` | Map of lowercase ISO code → USD value of 1 unit. e.g. `{ gbp: 1.27, jpy: 0.0067 }` |
| `zeroDecimalCurrencies` | `Set<string>` | Optional override. Defaults to `STRIPE_ZERO_DECIMAL_CURRENCIES` |

Returns a USD string to 2 decimal places (e.g. `"22.85"`), or `"0.00"` if the rate is missing.

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

### `STRIPE_ZERO_DECIMAL_CURRENCIES`

The default `Set<string>` of zero-decimal currency codes used by `convertSaleAmountToUSD`. Export it to extend with your own entries if needed.

### `GLITCHY_OFFER_ID`

The value of `process.env.GLITCHY_OFFER_ID`, or `""` if unset.
