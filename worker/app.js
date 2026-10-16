// HTTP routes for the booking site: public booking API, admin dashboard API and email notifications.
//
// Settings (Cloudflare dashboard → Worker → Settings → Variables and Secrets, type Secret):
//   ADMIN_PASSWORD      Password for the dashboard at /admin/ (required to use the dashboard).
//   RESEND_API_KEY      API key from https://resend.com, for email notifications.
//   BOOKING_TO_EMAIL    Where new-booking emails go (comma-separate several addresses).
//   BOOKING_FROM_EMAIL  Sender. Without your own domain: "Booking page <onboarding@resend.dev>".
//   CONFIRM_PATIENTS    Optional, "true" to email patients a confirmation. Needs a domain verified in Resend.

const RESEND_URL = "https://api.resend.com/emails";
const MAX_BODY_BYTES = 20_000;
const MIN_FILL_MS = 4_000;
const SESSION_DAYS = 14;
const COOKIE = "sp_admin";

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cache-Control": "no-store",
};

export async function handle(request, env) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  try {
    if (path === "/api/health") {
      return json({ ok: true, email: emailConfigured(env), admin: Boolean(env.ADMIN_PASSWORD) });
    }
    if (path === "/api/availability" && method === "GET") {
      const out = await store(env).availability();
      return json({ ok: true, ...out }, 200, { "Cache-Control": "no-store" });
    }
    if (path === "/api/bookings" && method === "POST") return createBooking(request, env, url);

    if (path.startsWith("/api/admin/")) {
      if (method !== "GET" && !sameOrigin(request, url)) return json({ ok: false, error: "forbidden" }, 403);
      if (path === "/api/admin/login" && method === "POST") return login(request, env, url);
      if (path === "/api/admin/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": cookie("", 0, url) });
      if (!(await isAdmin(request, env))) return json({ ok: false, error: "unauthorized" }, 401);
      return adminRoute(request, env, url);
    }
    if (path.startsWith("/api/")) return json({ ok: false, error: "not_found" }, 404);
    return env.ASSETS.fetch(request);
  } catch (err) {
    console.log(JSON.stringify({ event: "error", path, message: String(err && err.message) }));
    return json({ ok: false, error: "server_error" }, 500);
  }
}

const store = (env) => env.STORE.get(env.STORE.idFromName("main"));

// ---------------------------------------------------------------- public booking
async function createBooking(request, env, url) {
  if (!sameOrigin(request, url)) return json({ ok: false, error: "forbidden" }, 403);
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY_BYTES) return json({ ok: false, error: "too_large" }, 413);
  if (!(await allowed(env, request, "book"))) return json({ ok: false, error: "rate_limited" }, 429);

  const data = await readJson(request);
  if (!data) return json({ ok: false, error: "bad_request" }, 400);

  // Spam traps: a hidden field people never fill in, and a form completed too quickly.
  const started = Number(data._ts);
  if (data.website || (started && Date.now() - started < MIN_FILL_MS)) {
    console.log(JSON.stringify({ event: "booking_spam" }));
    return json({ ok: true, booking: { ref: "SP-RECEIVED", date: data.date, time: data.time } });
  }

  const result = await store(env).createBooking(data);
  if (!result.ok) return json(result, result.error === "slot_taken" ? 409 : 422);

  const b = result.booking;
  console.log(JSON.stringify({ event: "booking_created", ref: b.ref }));
  const emails = [];
  if (emailConfigured(env)) {
    emails.push(sendEmail(env, { to: list(env.BOOKING_TO_EMAIL), replyTo: b.email || undefined, ...staffEmail(b, url.origin) }));
    if (env.CONFIRM_PATIENTS === "true" && b.email) emails.push(sendEmail(env, { to: [b.email], ...patientEmail(b) }));
  }
  const sent = await Promise.all(emails);
  return json({
    ok: true,
    notified: sent.length > 0 && sent[0],
    booking: { ref: b.ref, date: b.date, time: b.time, service: b.service, name: b.name, contactBy: b.contactBy },
  });
}

// ---------------------------------------------------------------- admin
async function adminRoute(request, env, url) {
  const path = url.pathname;
  const method = request.method;
  const s = store(env);
  if (path === "/api/admin/session" && method === "GET") return json({ ok: true });
  if (path === "/api/admin/bookings" && method === "GET") {
    const p = url.searchParams;
    const [bookings, stats] = await Promise.all([
      s.listBookings({ status: p.get("status") || "", q: p.get("q") || "", view: p.get("view") || "upcoming" }),
      s.stats(),
    ]);
    return json({ ok: true, bookings, stats });
  }
  const m = path.match(/^\/api\/admin\/bookings\/(\d+)$/);
  if (m && method === "PATCH") {
    const body = await readJson(request);
    if (!body) return json({ ok: false, error: "bad_request" }, 400);
    const out = await s.updateBooking(Number(m[1]), body);
    return json(out, out.ok ? 200 : out.error === "not_found" ? 404 : 409);
  }
  if (m && method === "DELETE") {
    const out = await s.deleteBooking(Number(m[1]));
    return json(out, out.ok ? 200 : 404);
  }
  if (path === "/api/admin/export.csv" && method === "GET") {
    const csv = await s.exportCsv();
    return new Response("﻿" + csv, {
      headers: { ...SECURITY_HEADERS, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="bookings.csv"` },
    });
  }
  if (path === "/api/admin/settings" && method === "GET") return json({ ok: true, settings: await s.getSettings() });
  if (path === "/api/admin/settings" && method === "PUT") {
    const body = await readJson(request);
    if (!body) return json({ ok: false, error: "bad_request" }, 400);
    const out = await s.saveSettings(body);
    return json(out, out.ok ? 200 : 422);
  }
  return json({ ok: false, error: "not_found" }, 404);
}

async function login(request, env, url) {
  if (!env.ADMIN_PASSWORD) return json({ ok: false, error: "not_configured" }, 503);
  if (!(await allowed(env, request, "login"))) return json({ ok: false, error: "rate_limited" }, 429);
  const body = await readJson(request);
  const given = String(body?.password ?? "");
  if (!(await safeEqual(given, env.ADMIN_PASSWORD))) {
    console.log(JSON.stringify({ event: "login_failed" }));
    return json({ ok: false, error: "wrong_password" }, 401);
  }
  const expires = Date.now() + SESSION_DAYS * 86400_000;
  const token = `${expires}.${await sign(env, String(expires))}`;
  return json({ ok: true }, 200, { "Set-Cookie": cookie(token, SESSION_DAYS * 86400, url) });
}

async function isAdmin(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const raw = (request.headers.get("Cookie") || "").split(/;\s*/).find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return false;
  const [expires, mac] = raw.slice(COOKIE.length + 1).split(".");
  if (!expires || !mac || Number(expires) < Date.now()) return false;
  return safeEqual(mac, await sign(env, expires));
}

function cookie(value, maxAge, url) {
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

// Sessions are signed with the password, so changing the password signs everyone out.
async function sign(env, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("sp-session:" + env.ADMIN_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return btoa(String.fromCharCode(...new Uint8Array(mac))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function safeEqual(a, b) {
  const h = async (s) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(s))));
  const [x, y] = await Promise.all([h(a), h(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ---------------------------------------------------------------- helpers
function sameOrigin(request, url) {
  const origin = request.headers.get("Origin");
  return !origin || origin === url.origin;
}

async function allowed(env, request, kind) {
  const limiter = kind === "login" ? env.LOGIN_LIMITER : env.BOOKING_LIMITER;
  if (!limiter) return true;
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const { success } = await limiter.limit({ key: `${kind}:${ip}` });
  return success;
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...headers },
  });
}

// ---------------------------------------------------------------- email
function emailConfigured(env) {
  return Boolean(env.RESEND_API_KEY && env.BOOKING_TO_EMAIL && env.BOOKING_FROM_EMAIL);
}

async function sendEmail(env, { to, replyTo, subject, text, html }) {
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.BOOKING_FROM_EMAIL, to, ...(replyTo ? { reply_to: replyTo } : {}), subject, text, html }),
    });
    if (!res.ok) console.log(JSON.stringify({ event: "resend_error", status: res.status }));
    return res.ok;
  } catch {
    return false;
  }
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function prettyDate(date) {
  return new Date(date + "T12:00:00Z").toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}
export function prettyTime(time) {
  const [h, m] = time.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Shared email frame in the site's warm style (cream, sage, terracotta; serif headings).
function frame({ eyebrow, title, intro, body, accent = "#2f4a3a" }) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4ede3">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4ede3;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#fffdf9;border-radius:22px;overflow:hidden;border:1px solid #e7dccb">
<tr><td style="padding:22px 28px;border-bottom:1px solid #efe6d8">
<span style="font:600 13px/1 Georgia,'Times New Roman',serif;letter-spacing:.24em;color:#2f4a3a">DENTAL</span>
<span style="font:13px/1 Arial,sans-serif;color:#8a7f70"> &nbsp;·&nbsp; with Stephanie</span></td></tr>
<tr><td style="padding:28px 28px 8px">
<div style="font:bold 11px/1 Arial,sans-serif;letter-spacing:.18em;text-transform:uppercase;color:${accent};margin-bottom:12px">${eyebrow}</div>
<div style="font:400 30px/1.15 Georgia,'Times New Roman',serif;color:#1f2a24;margin-bottom:10px">${title}</div>
<div style="font:15px/1.6 Arial,sans-serif;color:#5d5a52">${intro}</div></td></tr>
<tr><td style="padding:12px 28px 28px">${body}</td></tr>
<tr><td style="padding:18px 28px;background:#f7f1e8;font:12px/1.6 Arial,sans-serif;color:#8a7f70">
Stephanie Pauls · 9000 Jane Street, Concord, ON L4K 0M6 · 647-629-6061</td></tr>
</table></td></tr></table></body></html>`;
}

function detailTable(rows) {
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:6px">${rows
    .map(([k, v]) => `<tr><td style="padding:11px 0;border-bottom:1px solid #efe6d8;font:13px Arial,sans-serif;color:#8a7f70;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:11px 0;border-bottom:1px solid #efe6d8;font:bold 15px/1.4 Arial,sans-serif;color:#1f2a24">${esc(v)}</td></tr>`)
    .join("")}</table>`;
}

const button = (href, label, bg, color = "#ffffff") =>
  `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 10px 0;padding:12px 20px;border-radius:999px;background:${bg};color:${color};text-decoration:none;font:bold 14px Arial,sans-serif">${label}</a>`;

export function staffEmail(b, origin) {
  const urgent = b.service === "Toothache or emergency";
  const when = `${prettyDate(b.date)} at ${prettyTime(b.time)}`;
  const tel = b.phone.replace(/[^\d+]/g, "");
  const insurance = b.insurance === "Yes" && b.provider ? `Yes (${b.provider})` : b.insurance;
  const rows = [
    ["When", when], ["Visit", b.service], ["Patient", b.patient], ["People", b.people],
    ["Reach by", b.contactBy], ["Phone", b.phone], ...(b.email ? [["Email", b.email]] : []),
    ["Insurance", insurance], ["Reference", b.ref],
  ];
  const subject = `${urgent ? "URGENT · " : ""}New booking: ${b.name}, ${when}`;
  const html = frame({
    eyebrow: urgent ? "Urgent booking" : "New booking",
    accent: urgent ? "#b4532f" : "#4f7360",
    title: esc(b.name),
    intro: `${esc(b.service)} &middot; ${esc(when)}${urgent ? `<br><strong style="color:#b4532f">Toothache or emergency: please call them as soon as you can.</strong>` : ""}`,
    body:
      `<div style="margin:4px 0 14px">${button(`tel:${tel}`, "Call", "#2f4a3a")}${button(`sms:${tel}`, "Text", "#c2734f")}${b.email ? button(`mailto:${b.email}`, "Email", "#efe6d8", "#2f4a3a") : ""}</div>` +
      detailTable(rows) +
      (b.message ? `<div style="margin-top:16px;padding:14px 16px;background:#f7f1e8;border-radius:14px;font:15px/1.6 Arial,sans-serif;color:#1f2a24;white-space:pre-wrap">${esc(b.message)}</div>` : "") +
      `<div style="margin-top:20px">${button(`${origin}/admin/`, "Open dashboard &rarr;", "#1f2a24")}</div>`,
  });
  const text =
    `New booking${urgent ? " (URGENT: toothache or emergency)" : ""}\n\n${b.name}\n` +
    rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
    `${b.message ? `\n\nNote:\n${b.message}` : ""}\n\nDashboard: ${origin}/admin/`;
  return { subject, text, html };
}

export function patientEmail(b) {
  const when = `${prettyDate(b.date)} at ${prettyTime(b.time)}`;
  const rows = [["When", when], ["Visit", b.service], ["Where", "9000 Jane Street, Concord"], ["Reference", b.ref]];
  const html = frame({
    eyebrow: "Request received",
    title: `Thank you, ${esc(b.name.split(" ")[0])}.`,
    intro: `I've saved <strong>${esc(when)}</strong> for you. I'll ${b.contactBy === "Email" ? "email" : b.contactBy === "Text" ? "text" : "call"} you soon to confirm. — Stephanie`,
    body:
      detailTable(rows) +
      `<div style="margin-top:18px">${button("tel:+16476296061", "Call 647-629-6061", "#2f4a3a")}${button("https://www.google.com/maps/dir/?api=1&destination=9000+Jane+Street+Concord+ON+L4K+0M6", "Directions", "#efe6d8", "#2f4a3a")}</div>`,
  });
  const text = `Thank you, ${b.name}. I've saved ${when} for you and will contact you soon to confirm.\n\n${rows.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nStephanie · 647-629-6061`;
  return { subject: `Your visit request: ${when}`, text, html };
}
