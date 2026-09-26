"use client";

import { useEffect } from "react";

const COOKIE_MAX_AGE = 30 * 24 * 60 * 60; // 30 days

function sanitize(val: string | null): string {
    return (val ?? "").trim().replace(/[^a-zA-Z0-9_\-\.]/g, "").slice(0, 64);
}

function setCookie(name: string, value: string) {
    if (!value) return;
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${name}=${value}; Max-Age=${COOKIE_MAX_AGE}; Path=/; SameSite=Lax${secure}`;
}

function pick(p: URLSearchParams, ...names: string[]): string {
    for (const n of names) {
        const v = sanitize(p.get(n));
        if (v) return v;
    }
    return "";
}

/**
 * Drop this in your root layout — no props needed, renders nothing.
 *
 * On mount it reads Glitchy click tokens from the landing URL and writes them
 * into 30-day cookies so your checkout route can forward them to Stripe.
 *
 * Cookie layout:
 *   gc_sub1  — affiliate id
 *   gc_sub2  — offer id
 *   gc_sub4  — traffic source
 *   gc_txid  — click transaction id (the attribution token)
 *
 * If your offer destination URL maps sub1 → {transaction_id}, gc_txid falls
 * back to sub1 automatically.
 */
export function GlitchyTracker() {
    useEffect(() => {
        try {
            const p = new URLSearchParams(window.location.search);
            setCookie("gc_sub1", pick(p, "sub1", "aff_id", "affiliate_id"));
            setCookie("gc_sub2", pick(p, "sub2", "offer_id"));
            setCookie("gc_sub4", pick(p, "sub4", "source"));
            setCookie("gc_txid", pick(p, "transaction_id", "sub3", "aff_sub", "sub1"));
        } catch {}
    }, []);

    return null;
}
