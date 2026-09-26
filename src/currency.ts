/**
 * Stripe zero-decimal currencies — amount_total is already in major units
 * (e.g. ¥1328 not 132800). Source: https://docs.stripe.com/currencies#zero-decimal
 */
const ZERO_DECIMAL_CURRENCIES = new Set([
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf",
    "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

const FX_URL = "https://api.frankfurter.app/latest?from=USD";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Approximate fallback rates used only when Frankfurter is unreachable and
// the in-memory cache is cold (e.g. fresh serverless instance + network error).
const FALLBACK_USD_RATES: Record<string, number> = {
    usd: 1,
    gbp: 1.27,
    eur: 1.08,
    aud: 0.65,
    nzd: 0.60,
    cad: 0.73,
    chf: 1.12,
    jpy: 0.0067,
    krw: 0.00073,
    inr: 0.012,
    sgd: 0.74,
    hkd: 0.13,
    mxn: 0.058,
    brl: 0.19,
    pln: 0.25,
    sek: 0.095,
    nok: 0.093,
    dkk: 0.145,
    czk: 0.045,
    huf: 0.0028,
    ron: 0.22,
    bgn: 0.55,
    try: 0.029,
    zar: 0.055,
    aed: 0.27,
    sar: 0.27,
    ils: 0.27,
    thb: 0.028,
    myr: 0.22,
    php: 0.017,
    idr: 0.000063,
    vnd: 0.000040,
    twd: 0.031,
    clp: 0.0011,
    cop: 0.00024,
    ars: 0.00093,
};

let _rates: Record<string, number> | null = null;
let _ratesExpiry = 0;

async function getUsdRates(): Promise<Record<string, number>> {
    if (_rates && Date.now() < _ratesExpiry) return _rates;

    try {
        const res = await fetch(FX_URL);
        const json = await res.json() as { rates: Record<string, number> };

        // Frankfurter returns "1 USD = X foreign", we need "1 foreign = Y USD"
        const rates: Record<string, number> = { usd: 1 };
        for (const [code, rate] of Object.entries(json.rates)) {
            rates[code.toLowerCase()] = 1 / rate;
        }

        _rates = rates;
        _ratesExpiry = Date.now() + CACHE_TTL_MS;
        return rates;
    } catch (err) {
        console.error("glitchy-stripe: failed to fetch exchange rates, using fallback:", err);
        return _rates ?? FALLBACK_USD_RATES;
    }
}

/**
 * Convert a Stripe `amount_total` in any currency to a USD string for the
 * Glitchy postback. Fetches live exchange rates from Frankfurter and caches
 * them for 1 hour — you just pass the raw Stripe values.
 *
 * @param amountTotal  Stripe's raw amount_total (smallest unit — pence, cents,
 *                     etc. — except for zero-decimal currencies like JPY where
 *                     it is already in major units).
 * @param currency     ISO 4217 code, case-insensitive ("gbp", "JPY", "usd").
 *
 * @returns USD amount formatted to 2 decimal places, e.g. "22.85".
 *          Falls back to stale cache on network error; returns "0.00" if no
 *          rate is available.
 *
 * @example
 * await convertSaleAmountToUSD(1799, "gbp")  // → "22.85"  (£17.99 → USD)
 * await convertSaleAmountToUSD(1328, "jpy")  // → "8.90"   (¥1328 → USD, zero-decimal)
 * await convertSaleAmountToUSD(2285, "usd")  // → "22.85"  (no conversion needed)
 */
export async function convertSaleAmountToUSD(
    amountTotal: number,
    currency: string,
): Promise<string> {
    const cur = currency.toLowerCase();

    if (cur === "usd") {
        return (amountTotal / 100).toFixed(2);
    }

    const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(cur);
    const decimalAmount = isZeroDecimal ? amountTotal : amountTotal / 100;

    const rates = await getUsdRates();
    const rate = rates[cur];

    if (!rate) {
        console.error(`glitchy-stripe: no USD rate for "${currency}" — returning 0.00`);
        return "0.00";
    }

    return (decimalAmount * rate).toFixed(2);
}
