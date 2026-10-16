// Tests for the booking Worker. Run with: npm test
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker, { validate, buildEmail } from "./index.js";

const ORIGIN = "https://booking.example.workers.dev";
const realFetch = globalThis.fetch;
let sent;

const good = [
  ["_ts", String(Date.now() - 20_000)],
  ["website", ""],
  ["Service", "Check-up & cleaning"],
  ["Patient", "New patient"],
  ["Preferred days", "Mon"],
  ["Preferred days", "Wed"],
  ["Preferred times", "Evening (6–9pm)"],
  ["Preferred date", ""],
  ["Name", "Jane Doe"],
  ["Phone", "(905) 555-0100"],
  ["Email", "jane@example.com"],
  ["Contact by", "Text"],
  ["People", "2 people"],
  ["Insurance", "Yes"],
  ["Insurance provider", "Sun Life"],
  ["Message", "Me and my son."],
  ["Consent", "yes"],
];
const withField = (name, value) => good.filter(([k]) => k !== name).concat(value === undefined ? [] : [[name, value]]);

const configured = {
  RESEND_API_KEY: "re_test",
  BOOKING_TO_EMAIL: "me@example.com, backup@example.com",
  BOOKING_FROM_EMAIL: "Booking page <onboarding@resend.dev>",
};

function env(extra = {}, limiterOk = true) {
  return {
    ASSETS: { fetch: () => new Response("asset") },
    BOOKING_LIMITER: { limit: async () => ({ success: limiterOk }) },
    ...extra,
  };
}

function post(fields, { accept = "application/json", origin = ORIGIN } = {}) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded", Accept: accept };
  if (origin) headers.Origin = origin;
  return new Request(ORIGIN + "/api/book", { method: "POST", headers, body: new URLSearchParams(fields) });
}

beforeEach(() => {
  sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), init });
    if (String(url).includes("turnstile")) return Response.json({ success: init.body.get("response") === "ok" });
    return Response.json({ id: "email_1" });
  };
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("emails a valid booking through Resend", async () => {
  const res = await worker.fetch(post(good), env(configured));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(sent.length, 1);
  const body = JSON.parse(sent[0].init.body);
  assert.deepEqual(body.to, ["me@example.com", "backup@example.com"]);
  assert.equal(body.reply_to, "jane@example.com");
  assert.equal(body.subject, "Booking request: Jane Doe (Check-up & cleaning)");
  assert.match(body.text, /Days: Mon, Wed/);
  assert.match(body.text, /Insurance: Yes \(Sun Life\)/);
  assert.match(body.html, /href="sms:9055550100"/);
});

test("flags emergencies in the subject", () => {
  const { values } = validate(Object.fromEntries(withField("Service", "Toothache or emergency").map(([k, v]) => [k, [v]])));
  assert.match(buildEmail(values).subject, /^URGENT: /);
});

test("answers 503 when email isn't configured, so the page uses its backup", async () => {
  const res = await worker.fetch(post(good), env());
  assert.equal(res.status, 503);
  assert.deepEqual(await res.json(), { ok: false, error: "not_configured" });
  assert.equal(sent.length, 0);
});

test("returns field errors", async () => {
  const res = await worker.fetch(post(withField("Phone", "abc").filter(([k]) => k !== "Service").concat([["Service", "Brain surgery"]])), env(configured));
  assert.equal(res.status, 422);
  const out = await res.json();
  assert.ok(out.fields.Phone);
  assert.ok(out.fields.Service);
});

test("email is optional unless the visitor wants an email reply", () => {
  const asData = (pairs) => {
    const d = {};
    for (const [k, v] of pairs) (d[k] ||= []).push(v);
    return d;
  };
  assert.equal(validate(asData(withField("Email", ""))).errors.Email, undefined);
  const noEmail = withField("Email", "").filter(([k]) => k !== "Contact by").concat([["Contact by", "Email"]]);
  assert.ok(validate(asData(noEmail)).errors.Email);
});

test("requires consent", async () => {
  const res = await worker.fetch(post(withField("Consent")), env(configured));
  assert.equal(res.status, 422);
  assert.ok((await res.json()).fields.Consent);
});

test("silently drops honeypot and too-fast submissions", async () => {
  for (const fields of [withField("website", "spam.example"), withField("_ts", String(Date.now()))]) {
    const res = await worker.fetch(post(fields), env(configured));
    assert.equal(res.status, 200);
  }
  assert.equal(sent.length, 0);
});

test("rejects other origins and rate-limits", async () => {
  assert.equal((await worker.fetch(post(good, { origin: "https://evil.example" }), env(configured))).status, 403);
  assert.equal((await worker.fetch(post(good), env(configured, false))).status, 429);
});

test("reports Resend failures as 502", async () => {
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  assert.equal((await worker.fetch(post(good), env(configured))).status, 502);
});

test("redirects plain form posts back to the page", async () => {
  const ok = await worker.fetch(post(good, { accept: "text/html" }), env(configured));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get("Location"), ORIGIN + "/?sent=1#book");
  const bad = await worker.fetch(post(withField("Name", ""), { accept: "text/html" }), env(configured));
  assert.equal(bad.headers.get("Location"), ORIGIN + "/?error=invalid#book");
});

test("checks Turnstile when configured", async () => {
  const e = env({ ...configured, TURNSTILE_SECRET_KEY: "secret" });
  assert.equal((await worker.fetch(post(good.concat([["cf-turnstile-response", "bad"]])), e)).status, 400);
  assert.equal((await worker.fetch(post(good.concat([["cf-turnstile-response", "ok"]])), e)).status, 200);
});

test("escapes HTML in emails", () => {
  const pairs = withField("Name", "<b>Eve</b>").concat([]);
  const d = {};
  for (const [k, v] of pairs) (d[k] ||= []).push(v);
  const { html } = buildEmail(validate(d).values);
  assert.ok(!html.includes("<b>Eve</b>"));
  assert.ok(html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
});

test("every option on the page is accepted by the Worker", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const options = JSON.parse(readFileSync(new URL("../public/booking-options.json", import.meta.url), "utf8"));
  const decode = (s) => s.replace(/&amp;/g, "&");
  const values = (name) =>
    [...html.matchAll(new RegExp(`name="${name}" value="([^"]+)"`, "g"))].map((m) => decode(m[1]));
  assert.deepEqual(values("Service"), options.services);
  assert.deepEqual(values("Patient"), options.patient);
  assert.deepEqual(values("Preferred days"), options.days);
  assert.deepEqual(values("Preferred times"), options.times);
  assert.deepEqual(values("Insurance"), options.insurance);
  assert.deepEqual(values("Contact by"), options.contactBy);
  const people = [...html.matchAll(/<option>([^<]+)<\/option>/g)].map((m) => m[1]);
  assert.deepEqual(people, options.people);
});

test("health endpoint reports configuration", async () => {
  const res = await worker.fetch(new Request(ORIGIN + "/api/health"), env(configured));
  assert.deepEqual(await res.json(), { ok: true, email: true, turnstile: false });
});
