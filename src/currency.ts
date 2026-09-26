/**
 * Stripe zero-decimal currencies — amount_total is already in major units
 * (e.g. ¥1328 not 132800). Source: https://docs.stripe.com/currencies#zero-decimal
 */
export const STRIPE_ZERO_DECIMAL_CURRENCIES = new Set([
    "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg", "rwf",
    "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

/**
 * Convert a Stripe `amount_total` in any currency to a USD string for the
 * Glitchy postback. The postback carries no currency field, so the value you
 * send must already be in USD.
 *
 * @param amountTotal  Stripe's raw amount_total (smallest unit — cents for USD/GBP,
 *                     already in major units for zero-decimal currencies like JPY).
 * @param currency     ISO 4217 code, case-insensitive (e.g. "gbp", "JPY", "usd").
 * @param usdRates     Map of lowercase ISO code → how many USD one unit equals.
 *                     e.g. { gbp: 1.27, jpy: 0.0067, usd: 1 }
 *                     Only needs to cover the currencies your checkout supports.
 * @param zeroDecimalCurrencies  Override the default zero-decimal set if your
 *                     Stripe config treats additional currencies as zero-decimal.
 *
 * @returns USD amount formatted to 2 decimal places, e.g. "22.85".
 *          Returns "0.00" and logs an error if the rate is missing.
 *
 * @example
 * // Build rates once from your existing GBP base table:
 * const USD_PER_GBP = 1.27;
 * const GBP_TO = { GBP: 1, USD: 1.27, JPY: 190, EUR: 1.17 };
 * const usdRates = Object.fromEntries(
 *     Object.entries(GBP_TO).map(([k, v]) => [k.toLowerCase(), USD_PER_GBP / v])
 * );
 *
 * // In your Stripe webhook:
 * const saleAmountUSD = convertSaleAmountToUSD(
 *     session.amount_total ?? 0,
 *     session.currency ?? "usd",
 *     usdRates,
 * );
 */
export function convertSaleAmountToUSD(
    amountTotal: number,
    currency: string,
    usdRates: Record<string, number>,
    zeroDecimalCurrencies: Set<string> = STRIPE_ZERO_DECIMAL_CURRENCIES,
): string {
    const cur = currency.toLowerCase();
    const isZeroDecimal = zeroDecimalCurrencies.has(cur);
    const decimalAmount = isZeroDecimal ? amountTotal : amountTotal / 100;

    if (cur === "usd") {
        return decimalAmount.toFixed(2);
    }

    const rate = usdRates[cur];
    if (!rate) {
        console.error(
            `convertSaleAmountToUSD: no USD rate for currency "${currency}" — returning 0.00`,
        );
        return "0.00";
    }

    return (decimalAmount * rate).toFixed(2);
}
