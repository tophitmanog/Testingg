// Cloudflare Worker: serves the page from public/ and handles booking requests at /api/book.
//
// Static files are served by Workers Static Assets; this script only runs for /api/* (see wrangler.jsonc).
//
// Configure in the Cloudflare dashboard → Worker → Settings → Variables and Secrets (type: Secret):
//   RESEND_API_KEY        API key from https://resend.com
//   BOOKING_TO_EMAIL      Where requests are sent (comma-separate several addresses)
//   BOOKING_FROM_EMAIL    Sender. Without your own domain use "Booking page <onboarding@resend.dev>"
//                         (Resend then only delivers to the email address the Resend account was made with).
//   TURNSTILE_SECRET_KEY  Optional: enables the Cloudflare Turnstile check.
// Until email is configured, /api/book answers 503 and the page falls back to the backup email service.

import options from "../public/booking-options.json" with { type: "json" };

const RESEND_URL = "https://api.resend.com/emails";
const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_BODY_BYTES = 20_000;
const MIN_FILL_MS = 4_000; // Faster than this is almost certainly a bot.

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/book") return handleBooking(request, env, url);
    if (url.pathname === "/api/health") {
      return json({ ok: true, email: emailConfigured(env), turnstile: Boolean(env.TURNSTILE_SECRET_KEY) });
    }
    if (url.pathname.startsWith("/api/")) return json({ ok: false, error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  },
};

async function handleBooking(request, env, url) {
  if (request.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405, { Allow: "POST" });

  // Only accept requests from this site.
  const origin = request.headers.get("Origin");
  if (origin && origin !== url.origin) return json({ ok: false, error: "forbidden" }, 403);

  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) {
    return json({ ok: false, error: "too_large" }, 413);
  }

  const wantsJson = (request.headers.get("Accept") || "").includes("application/json");
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";

  if (env.BOOKING_LIMITER) {
    const { success } = await env.BOOKING_LIMITER.limit({ key: ip });
    if (!success) return reply(wantsJson, url, { ok: false, error: "rate_limited" }, 429);
  }

  let data;
  try {
    data = await readBody(request);
  } catch {
    return reply(wantsJson, url, { ok: false, error: "bad_request" }, 400);
  }

  // Spam traps: a hidden field people never fill in, and a form submitted too quickly.
  // Pretend it worked so bots get no signal.
  const started = Number(one(data._ts));
  if (one(data.website) || (started && Date.now() - started < MIN_FILL_MS)) {
    console.log(JSON.stringify({ event: "booking_spam" }));
    return reply(wantsJson, url, { ok: true }, 200);
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const passed = await verifyTurnstile(env.TURNSTILE_SECRET_KEY, one(data["cf-turnstile-response"]), ip);
    if (!passed) return reply(wantsJson, url, { ok: false, error: "verification_failed" }, 400);
  }

  const { values, errors } = validate(data);
  if (Object.keys(errors).length) return reply(wantsJson, url, { ok: false, error: "invalid", fields: errors }, 422);

  if (!emailConfigured(env)) return reply(wantsJson, url, { ok: false, error: "not_configured" }, 503);

  const sent = await sendEmail(env, values);
  console.log(JSON.stringify({ event: sent ? "booking_sent" : "booking_send_failed" }));
  if (!sent) return reply(wantsJson, url, { ok: false, error: "send_failed" }, 502);

  return reply(wantsJson, url, { ok: true }, 200);
}

// Fields can repeat (e.g. several preferred days), so every value is kept as an array.
async function readBody(request) {
  const type = request.headers.get("Content-Type") || "";
  const out = {};
  const add = (k, v) => (out[k] ||= []).push(String(v ?? ""));
  if (type.includes("application/json")) {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("bad body");
    for (const [k, v] of Object.entries(body)) (Array.isArray(v) ? v : [v]).forEach((x) => add(k, x));
    return out;
  }
  const form = await request.formData();
  for (const [k, v] of form.entries()) if (typeof v === "string") add(k, v);
  return out;
}

// ---------------------------------------------------------------- validation
const one = (v) => (Array.isArray(v) ? v[0] : v) ?? "";
const clean = (s, max) =>
  String(s ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, max);
const oneLine = (s, max) => clean(s, max).replace(/\s+/g, " ");

export function validate(data) {
  const errors = {};
  const pick = (field, list, fallback) => {
    const v = oneLine(one(data[field]), 60) || fallback;
    if (!list.includes(v)) errors[field] = "Please choose one of the options.";
    return v;
  };

  const values = {
    service: pick("Service", options.services),
    patient: pick("Patient", options.patient, options.patient[0]),
    days: [...new Set((data["Preferred days"] || []).map((d) => oneLine(d, 20)).filter(Boolean))],
    times: [...new Set((data["Preferred times"] || []).map((t) => oneLine(t, 30)).filter(Boolean))],
    date: oneLine(one(data["Preferred date"]), 10),
    name: oneLine(one(data.Name), 100),
    phone: oneLine(one(data.Phone), 30),
    email: oneLine(one(data.Email), 254),
    people: pick("People", options.people, options.people[0]),
    insurance: pick("Insurance", options.insurance, options.insurance[options.insurance.length - 1]),
    provider: oneLine(one(data["Insurance provider"]), 80),
    contactBy: pick("Contact by", options.contactBy, options.contactBy[0]),
    message: clean(one(data.Message), 2000),
    consent: one(data.Consent) === "yes",
  };

  if (!values.days.length) values.days = ["Any day"];
  if (!values.times.length) values.times = ["Any time"];
  if (values.days.some((d) => !options.days.includes(d))) errors["Preferred days"] = "Please choose days from the list.";
  if (values.times.some((t) => !options.times.includes(t))) errors["Preferred times"] = "Please choose times from the list.";
  if (values.date && !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) errors["Preferred date"] = "Please choose a valid date.";

  if (values.name.length < 2) errors.Name = "Please enter your name.";
  const digits = values.phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || !/^[\d\s()+.\-x]+$/i.test(values.phone)) {
    errors.Phone = "Please enter a valid phone number.";
  }
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(values.email)) {
    errors.Email = "Please check your email address.";
  }
  if (values.contactBy === "Email" && !values.email) errors.Email = "Add an email so I can reply by email.";
  if (!values.consent) errors.Consent = "Please tick the box so I can contact you.";
  return { values, errors };
}

// ---------------------------------------------------------------- integrations
function emailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && env.BOOKING_TO_EMAIL && env.BOOKING_FROM_EMAIL);
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  try {
    const res = await fetch(TURNSTILE_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const out = await res.json();
    return out.success === true;
  } catch {
    return false;
  }
}

export function buildEmail(v) {
  const urgent = v.service === "Toothache or emergency";
  const insurance = v.insurance === "Yes" && v.provider ? `Yes (${v.provider})` : v.insurance;
  const rows = [
    ["Visit", v.service],
    ["Patient", v.patient],
    ["People", v.people],
    ["Days", v.days.join(", ")],
    ["Times", v.times.join(", ")],
    ...(v.date ? [["Date", v.date]] : []),
    ["Insurance", insurance],
    ["Reach by", v.contactBy],
    ["Phone", v.phone],
    ...(v.email ? [["Email", v.email]] : []),
  ];
  const subject = `${urgent ? "URGENT: " : ""}Booking request: ${v.name} (${v.service})`;
  const tel = v.phone.replace(/[^\d+]/g, "");
  const text =
    `${urgent ? "URGENT: this patient chose toothache or emergency.\n\n" : ""}` +
    `${v.name}\n${rows.map(([k, val]) => `${k}: ${val}`).join("\n")}` +
    `${v.message ? `\n\nNote:\n${v.message}` : ""}\n\nSent from your booking page.`;

  const cell = "padding:8px 12px;border-bottom:1px solid #e4eeed;font:15px/1.4 Arial,sans-serif";
  const button = (href, label, bg) =>
    `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 18px;border-radius:99px;background:${bg};color:#fff;text-decoration:none;font:bold 14px Arial,sans-serif">${label}</a>`;
  const html =
    `<div style="max-width:560px;margin:0 auto;border:1px solid #dfe9e8;border-radius:16px;overflow:hidden">` +
    `<div style="background:${urgent ? "#c0392b" : "#23857e"};color:#fff;padding:16px 20px;font:bold 18px Arial,sans-serif">` +
    `${urgent ? "Urgent booking request" : "New booking request"}</div>` +
    `<div style="padding:16px 20px"><p style="margin:0 0 12px;font:bold 20px Arial,sans-serif;color:#2f3a3e">${esc(v.name)}</p>` +
    `${button(`tel:${tel}`, "Call", "#23857e")}${button(`sms:${tel}`, "Text", "#2f3a3e")}` +
    `${v.email ? button(`mailto:${v.email}`, "Email", "#5f6b70") : ""}` +
    `<table cellspacing="0" style="width:100%;border-collapse:collapse;margin-top:8px">${rows
      .map(([k, val]) => `<tr><td style="${cell};color:#5f6b70;width:110px">${esc(k)}</td><td style="${cell};color:#2f3a3e"><strong>${esc(val)}</strong></td></tr>`)
      .join("")}</table>` +
    `${v.message ? `<p style="margin:16px 0 0;padding:12px 14px;background:#f3faf9;border-radius:12px;font:15px/1.5 Arial,sans-serif;white-space:pre-wrap;color:#2f3a3e">${esc(v.message)}</p>` : ""}` +
    `<p style="margin:16px 0 0;font:12px Arial,sans-serif;color:#5f6b70">Sent from your booking page.${v.email ? ` Reply to this email to answer ${esc(v.name)}.` : ""}</p></div></div>`;
  return { subject, text, html };
}

async function sendEmail(env, v) {
  const { subject, text, html } = buildEmail(v);
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.BOOKING_FROM_EMAIL,
        to: env.BOOKING_TO_EMAIL.split(",").map((s) => s.trim()).filter(Boolean),
        ...(v.email ? { reply_to: v.email } : {}),
        subject,
        text,
        html,
      }),
    });
    if (!res.ok) console.log(JSON.stringify({ event: "resend_error", status: res.status }));
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- responses
function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

// JavaScript submissions get JSON; plain HTML form posts (no JavaScript) get a redirect back to the page.
function reply(wantsJson, url, body, status) {
  if (wantsJson) return json(body, status);
  const to = body.ok ? "/?sent=1#book" : `/?error=${encodeURIComponent(body.error)}#book`;
  return new Response(null, { status: 303, headers: { Location: new URL(to, url.origin).href, ...SECURITY_HEADERS } });
}
