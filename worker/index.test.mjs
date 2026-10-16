// Tests for the booking backend. Run with: npm test
// Uses Node's built-in SQLite in place of the Durable Object's storage.
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Store, clinicNow } from "./store.js";
import { handle, staffEmail } from "./app.js";

const ORIGIN = "https://booking.example.workers.dev";
const realFetch = globalThis.fetch;
let sent, store, env;

// Minimal stand-in for ctx.storage.sql in a Durable Object.
function memorySql() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query, ...params) {
      const stmt = db.prepare(query);
      const rows = /^\s*(SELECT|WITH)|RETURNING/i.test(query) ? stmt.all(...params) : (stmt.run(...params), []);
      return { toArray: () => rows, one: () => rows[0] };
    },
  };
}

// A Wednesday at 10:00 clinic time (14:00 UTC in October, Eastern Daylight Time).
const NOW = new Date("2026-10-14T14:00:00Z");
const nextDayDate = "2026-10-15"; // Thursday

function booking(extra = {}) {
  return {
    _ts: Date.now() - 20_000, website: "",
    service: "Check-up & cleaning", patient: "New patient", date: nextDayDate, time: "10:00",
    name: "Jane Doe", phone: "(905) 555-0100", email: "jane@example.com", contactBy: "Text",
    people: "2 people", insurance: "Yes", provider: "Sun Life", message: "Me and my son.", consent: true,
    ...extra,
  };
}

// Durable Object stub: calls go straight to the Store (with a fixed clock).
function stubFor(s) {
  const fixed = new Proxy(s, { get: (t, k) => (typeof t[k] === "function" ? (...a) => {
    const arity = { availability: 0, createBooking: 1, listBookings: 1, stats: 0, updateBooking: 2 }[k];
    return Promise.resolve(arity === undefined ? t[k](...a) : t[k](...a.slice(0, arity), ...Array(Math.max(0, arity - a.length)).fill(undefined), NOW));
  } : t[k]) });
  return { idFromName: () => "main", get: () => fixed };
}

function req(path, { method = "GET", body, cookie, origin = ORIGIN } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (origin) headers.Origin = origin;
  if (cookie) headers.Cookie = cookie;
  return new Request(ORIGIN + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

async function adminCookie() {
  const res = await handle(req("/api/admin/login", { method: "POST", body: { password: "s3cret-pass" } }), env);
  assert.equal(res.status, 200);
  return res.headers.get("Set-Cookie").split(";")[0];
}

beforeEach(() => {
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), body: JSON.parse(init.body) });
    return Response.json({ id: "email_1" });
  };
  store = new Store(memorySql());
  env = {
    STORE: stubFor(store),
    ASSETS: { fetch: () => new Response("asset") },
    ADMIN_PASSWORD: "s3cret-pass",
    RESEND_API_KEY: "re_test",
    BOOKING_TO_EMAIL: "me@example.com",
    BOOKING_FROM_EMAIL: "Booking page <onboarding@resend.dev>",
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("clinic time follows Toronto", () => {
  assert.equal(clinicNow(NOW).toISOString().slice(0, 16), "2026-10-14T10:00");
});

test("availability respects hours, notice period and slot length", () => {
  const { days } = store.availability(NOW);
  assert.equal(days[0].date, "2026-10-14");
  assert.equal(days[0].times[0], "13:00", "3 hours' notice from 10:00");
  assert.equal(days[0].times.at(-1), "20:30", "last weekday slot ends at 9pm");
  const sat = days.find((d) => d.date === "2026-10-17");
  assert.equal(sat.times[0], "08:00");
  assert.equal(sat.times.at(-1), "17:30");
  assert.equal(days.length, 31);
});

test("a booked slot disappears and can't be booked twice", () => {
  assert.equal(store.createBooking(booking(), NOW).ok, true);
  const day = store.availability(NOW).days.find((d) => d.date === nextDayDate);
  assert.ok(!day.times.includes("10:00"));
  const again = store.createBooking(booking({ name: "Sam" }), NOW);
  assert.equal(again.error, "slot_taken");
});

test("cancelling frees the slot; re-activating checks it again", () => {
  const a = store.createBooking(booking(), NOW).booking;
  store.updateBooking(a.id, { status: "cancelled" }, NOW);
  const b = store.createBooking(booking({ name: "Sam" }), NOW);
  assert.equal(b.ok, true);
  assert.equal(store.updateBooking(a.id, { status: "confirmed" }, NOW).error, "slot_taken");
});

test("settings change availability: closed days, blocked dates, slot length", () => {
  const s = store.getSettings();
  s.weekly[4].open = false; // Thursday off
  s.blocked = ["2026-10-16"];
  s.slotMinutes = 60;
  assert.equal(store.saveSettings(s).ok, true);
  const { days } = store.availability(NOW);
  assert.deepEqual(days.find((d) => d.date === "2026-10-15").times, []);
  assert.deepEqual(days.find((d) => d.date === "2026-10-16").times, []);
  assert.equal(days.find((d) => d.date === "2026-10-19").times[1], "10:00");
  assert.equal(store.createBooking(booking(), NOW).error, "slot_taken");
});

test("rejects bad settings", () => {
  const s = store.getSettings();
  s.weekly[1] = { open: true, start: "18:00", end: "09:00" };
  assert.equal(store.saveSettings(s).ok, false);
});

test("POST /api/bookings stores the booking and emails Stephanie", async () => {
  const res = await handle(req("/api/bookings", { method: "POST", body: booking() }), env);
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.match(out.booking.ref, /^CD-[A-Z2-9]{6}$/);
  assert.equal(out.notified, true);
  assert.equal(store.listBookings({ view: "all" }, NOW).length, 1);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ["me@example.com"]);
  assert.equal(sent[0].body.reply_to, "jane@example.com");
  assert.match(sent[0].body.subject, /^New booking: Jane Doe, Thursday, October 15 at 10:00 AM$/);
  assert.match(sent[0].body.html, /\/admin\//);
});

test("still stores bookings when email isn't set up", async () => {
  delete env.RESEND_API_KEY;
  const res = await handle(req("/api/bookings", { method: "POST", body: booking() }), env);
  assert.equal(res.status, 200);
  assert.equal(sent.length, 0);
  assert.equal(store.stats(NOW).total, 1);
});

test("patient confirmation only when enabled", async () => {
  env.CONFIRM_PATIENTS = "true";
  await handle(req("/api/bookings", { method: "POST", body: booking() }), env);
  assert.equal(sent.length, 2);
  assert.deepEqual(sent[1].body.to, ["jane@example.com"]);
});

test("validation errors and taken slots", async () => {
  let res = await handle(req("/api/bookings", { method: "POST", body: booking({ phone: "abc", consent: false }) }), env);
  assert.equal(res.status, 422);
  const out = await res.json();
  assert.ok(out.fields.phone && out.fields.consent);
  await handle(req("/api/bookings", { method: "POST", body: booking() }), env);
  res = await handle(req("/api/bookings", { method: "POST", body: booking() }), env);
  assert.equal(res.status, 409);
});

test("spam traps and other origins", async () => {
  await handle(req("/api/bookings", { method: "POST", body: booking({ website: "x" }) }), env);
  await handle(req("/api/bookings", { method: "POST", body: booking({ _ts: Date.now() }) }), env);
  assert.equal(store.stats(NOW).total, 0);
  const res = await handle(req("/api/bookings", { method: "POST", body: booking(), origin: "https://evil.example" }), env);
  assert.equal(res.status, 403);
});

test("admin API needs a valid session", async () => {
  assert.equal((await handle(req("/api/admin/bookings"), env)).status, 401);
  assert.equal((await handle(req("/api/admin/login", { method: "POST", body: { password: "nope" } }), env)).status, 401);
  assert.equal((await handle(req("/api/admin/bookings", { cookie: "cd_admin=9999999999999.forged" }), env)).status, 401);
  const cookie = await adminCookie();
  assert.equal((await handle(req("/api/admin/bookings", { cookie }), env)).status, 200);
  env.ADMIN_PASSWORD = "changed";
  assert.equal((await handle(req("/api/admin/bookings", { cookie }), env)).status, 401, "changing the password signs out");
});

test("admin can list, update, export and delete bookings", async () => {
  await handle(req("/api/bookings", { method: "POST", body: booking({ name: "=HYPERLINK(\"x\")" }) }), env);
  const cookie = await adminCookie();
  let out = await (await handle(req("/api/admin/bookings?view=all", { cookie }), env)).json();
  assert.equal(out.bookings.length, 1);
  assert.equal(out.stats.newCount, 1);
  const id = out.bookings[0].id;
  const upd = await handle(req(`/api/admin/bookings/${id}`, { method: "PATCH", cookie, body: { status: "confirmed", notes: "Called, all set" } }), env);
  assert.equal((await upd.json()).booking.status, "confirmed");
  const csv = await (await handle(req("/api/admin/export.csv", { cookie }), env)).text();
  assert.match(csv, /Called, all set/);
  assert.match(csv, /"'=HYPERLINK/, "formulas are neutralised");
  assert.equal((await handle(req(`/api/admin/bookings/${id}`, { method: "DELETE", cookie }), env)).status, 200);
  out = await (await handle(req("/api/admin/bookings?view=all", { cookie }), env)).json();
  assert.equal(out.bookings.length, 0);
});

test("admin writes are blocked from other sites", async () => {
  const cookie = await adminCookie();
  const res = await handle(req("/api/admin/settings", { method: "PUT", cookie, origin: "https://evil.example", body: {} }), env);
  assert.equal(res.status, 403);
});

test("admin settings round-trip", async () => {
  const cookie = await adminCookie();
  const { settings } = await (await handle(req("/api/admin/settings", { cookie }), env)).json();
  settings.daysAhead = 14;
  const res = await handle(req("/api/admin/settings", { method: "PUT", cookie, body: settings }), env);
  assert.equal(res.status, 200);
  assert.equal(store.availability(NOW).days.length, 15);
});

test("emails escape what visitors type", () => {
  const { html } = staffEmail({ ...booking({ name: "<b>Eve</b>" }), ref: "CD-TEST01" }, ORIGIN);
  assert.ok(!html.includes("<b>Eve</b>"));
  assert.ok(html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
});

test("health endpoint", async () => {
  const out = await (await handle(req("/api/health"), env)).json();
  assert.deepEqual(out, { ok: true, email: true, admin: true });
});
