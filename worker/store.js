// Booking storage and availability rules.
//
// Runs inside a SQLite-backed Durable Object (see worker/index.js). Everything here works on a small
// `sql` interface — exec(query, ...params) returning { toArray(), one() } — so it can be tested in Node.
// Durable Objects handle one request at a time, so checking a slot and booking it can't race.

import options from "../public/booking-options.json" with { type: "json" };

export const TIME_ZONE = "America/Toronto";

export const DEFAULT_SETTINGS = {
  // Weekly hours by day number (0 = Sunday). Matches the clinic's opening hours.
  weekly: {
    0: { open: true, start: "08:00", end: "18:00" },
    1: { open: true, start: "09:00", end: "21:00" },
    2: { open: true, start: "09:00", end: "21:00" },
    3: { open: true, start: "09:00", end: "21:00" },
    4: { open: true, start: "09:00", end: "21:00" },
    5: { open: true, start: "09:00", end: "21:00" },
    6: { open: true, start: "08:00", end: "18:00" },
  },
  slotMinutes: 30,
  perSlot: 1, // How many bookings each time slot can take.
  daysAhead: 30, // How far ahead people can book.
  minNoticeHours: 3, // No bookings sooner than this.
  blocked: [], // Dates (YYYY-MM-DD) with no bookings, e.g. holidays.
};

export const STATUSES = ["new", "confirmed", "completed", "cancelled"];
const ACTIVE = ["new", "confirmed"]; // Bookings that hold their time slot.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    service TEXT NOT NULL,
    patient TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    contact_by TEXT NOT NULL,
    people TEXT NOT NULL,
    insurance TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS bookings_slot ON bookings (date, time, status)`,
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
];

// ---------------------------------------------------------------- time helpers
const pad = (n) => String(n).padStart(2, "0");
export const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const fromMinutes = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// The clinic's local wall-clock time, as a Date whose UTC fields hold the local values.
export function clinicNow(now = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute));
}
const dateKey = (d) => d.toISOString().slice(0, 10);
const weekday = (date) => new Date(date + "T00:00:00Z").getUTCDay();

// ---------------------------------------------------------------- validation
const clean = (s, max) =>
  String(s ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max);
const oneLine = (s, max) => clean(s, max).replace(/\s+/g, " ");
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateBooking(data) {
  const errors = {};
  const pick = (key, list, fallback) => {
    const v = oneLine(data[key], 60) || fallback;
    if (!list.includes(v)) errors[key] = "Please choose one of the options.";
    return v;
  };
  const v = {
    service: pick("service", options.services),
    patient: pick("patient", options.patient, options.patient[0]),
    date: oneLine(data.date, 10),
    time: oneLine(data.time, 5),
    name: oneLine(data.name, 100),
    phone: oneLine(data.phone, 30),
    email: oneLine(data.email, 254).toLowerCase(),
    contactBy: pick("contactBy", options.contactBy, options.contactBy[0]),
    people: pick("people", options.people, options.people[0]),
    insurance: pick("insurance", options.insurance, options.insurance[options.insurance.length - 1]),
    provider: oneLine(data.provider, 80),
    message: clean(data.message, 1500),
    consent: data.consent === true || data.consent === "yes",
  };
  if (!DATE.test(v.date) || !HHMM.test(v.time)) errors.slot = "Please choose a date and time.";
  if (v.name.length < 2) errors.name = "Please enter your name.";
  const digits = v.phone.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || !/^[\d\s()+.\-x]+$/i.test(v.phone)) errors.phone = "Please enter a valid phone number.";
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) errors.email = "Please check your email address.";
  if (v.contactBy === "Email" && !v.email) errors.email = "Add an email so I can reply by email.";
  if (v.insurance !== "Yes") v.provider = "";
  if (!v.consent) errors.consent = "Please tick the box so I can contact you.";
  return { values: v, errors };
}

export function validateSettings(input) {
  const s = structuredClone(DEFAULT_SETTINGS);
  const errors = [];
  for (let d = 0; d < 7; d++) {
    const day = input?.weekly?.[d];
    if (!day) continue;
    const start = String(day.start || ""), end = String(day.end || "");
    if (!HHMM.test(start) || !HHMM.test(end) || toMinutes(end) <= toMinutes(start)) {
      if (day.open) errors.push(`Check the hours for day ${d}.`);
      s.weekly[d] = { open: false, start: s.weekly[d].start, end: s.weekly[d].end };
      continue;
    }
    s.weekly[d] = { open: Boolean(day.open), start, end };
  }
  const num = (v, min, max, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
  };
  s.slotMinutes = [15, 20, 30, 45, 60, 90].includes(Number(input?.slotMinutes)) ? Number(input.slotMinutes) : 30;
  s.perSlot = num(input?.perSlot, 1, 10, 1);
  s.daysAhead = num(input?.daysAhead, 1, 120, 30);
  s.minNoticeHours = num(input?.minNoticeHours, 0, 72, 3);
  s.blocked = [...new Set((Array.isArray(input?.blocked) ? input.blocked : []).map(String).filter((x) => DATE.test(x)))].sort().slice(0, 200);
  return { settings: s, errors };
}

// ---------------------------------------------------------------- store
export class Store {
  constructor(sql) {
    this.sql = sql;
    for (const q of SCHEMA) sql.exec(q);
  }

  getSettings() {
    const row = this.sql.exec(`SELECT value FROM settings WHERE key = 'availability'`).toArray()[0];
    if (!row) return structuredClone(DEFAULT_SETTINGS);
    try {
      return validateSettings(JSON.parse(row.value)).settings;
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  saveSettings(input) {
    const { settings, errors } = validateSettings(input);
    if (errors.length) return { ok: false, errors };
    this.sql.exec(
      `INSERT INTO settings (key, value) VALUES ('availability', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      JSON.stringify(settings),
    );
    return { ok: true, settings };
  }

  // Open days and times for the booking calendar.
  availability(now = new Date()) {
    const s = this.getSettings();
    const local = clinicNow(now);
    const earliest = local.getTime() + s.minNoticeHours * 3600_000;
    const first = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
    const last = dateKey(new Date(first.getTime() + s.daysAhead * 86400_000));

    const taken = new Map();
    for (const r of this.sql
      .exec(`SELECT date, time, COUNT(*) AS n FROM bookings WHERE date >= ? AND date <= ? AND status IN ('new','confirmed') GROUP BY date, time`, dateKey(first), last)
      .toArray()) {
      taken.set(`${r.date} ${r.time}`, Number(r.n));
    }

    const days = [];
    for (let i = 0; i <= s.daysAhead; i++) {
      const d = new Date(first.getTime() + i * 86400_000);
      const date = dateKey(d);
      const rule = s.weekly[d.getUTCDay()];
      const times = [];
      if (rule.open && !s.blocked.includes(date)) {
        for (let m = toMinutes(rule.start); m + s.slotMinutes <= toMinutes(rule.end); m += s.slotMinutes) {
          const time = fromMinutes(m);
          if (d.getTime() + m * 60_000 < earliest) continue;
          if ((taken.get(`${date} ${time}`) || 0) >= s.perSlot) continue;
          times.push(time);
        }
      }
      days.push({ date, times });
    }
    return { timeZone: TIME_ZONE, slotMinutes: s.slotMinutes, days };
  }

  isAvailable(date, time, now = new Date()) {
    const day = this.availability(now).days.find((d) => d.date === date);
    return Boolean(day && day.times.includes(time));
  }

  createBooking(data, now = new Date()) {
    const { values, errors } = validateBooking(data);
    if (Object.keys(errors).length) return { ok: false, error: "invalid", fields: errors };
    if (!this.isAvailable(values.date, values.time, now)) {
      return { ok: false, error: "slot_taken", fields: { slot: "Sorry, that time was just taken. Please pick another." } };
    }
    const stamp = now.toISOString();
    const ref = makeRef();
    const row = this.sql
      .exec(
        `INSERT INTO bookings (ref, created_at, status, date, time, service, patient, name, phone, email, contact_by, people, insurance, provider, message, updated_at)
         VALUES (?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        ref, stamp, values.date, values.time, values.service, values.patient, values.name, values.phone, values.email,
        values.contactBy, values.people, values.insurance, values.provider, values.message, stamp,
      )
      .toArray()[0];
    return { ok: true, booking: shape(row) };
  }

  listBookings({ status = "", q = "", view = "upcoming" } = {}, now = new Date()) {
    const where = [], params = [];
    if (STATUSES.includes(status)) { where.push("status = ?"); params.push(status); }
    if (view === "upcoming") { where.push("date >= ?"); params.push(dateKey(clinicNow(now))); }
    if (view === "past") { where.push("date < ?"); params.push(dateKey(clinicNow(now))); }
    const term = oneLine(q, 80).toLowerCase();
    if (term) {
      where.push("(lower(name) LIKE ? OR phone LIKE ? OR lower(email) LIKE ? OR ref LIKE ?)");
      const like = `%${term.replace(/[%_]/g, "")}%`;
      params.push(like, like, like, like.toUpperCase());
    }
    const order = view === "past" ? "date DESC, time DESC" : view === "upcoming" ? "date ASC, time ASC" : "created_at DESC";
    return this.sql
      .exec(`SELECT * FROM bookings ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY ${order} LIMIT 500`, ...params)
      .toArray()
      .map(shape);
  }

  stats(now = new Date()) {
    const today = dateKey(clinicNow(now));
    const one = (q, ...p) => Number(this.sql.exec(q, ...p).toArray()[0]?.n || 0);
    return {
      newCount: one(`SELECT COUNT(*) AS n FROM bookings WHERE status = 'new'`),
      today: one(`SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND status IN ('new','confirmed')`, today),
      upcoming: one(`SELECT COUNT(*) AS n FROM bookings WHERE date >= ? AND status IN ('new','confirmed')`, today),
      total: one(`SELECT COUNT(*) AS n FROM bookings`),
    };
  }

  updateBooking(id, patch, now = new Date()) {
    const current = this.sql.exec(`SELECT * FROM bookings WHERE id = ?`, Number(id)).toArray()[0];
    if (!current) return { ok: false, error: "not_found" };
    const status = patch.status === undefined ? current.status : String(patch.status);
    if (!STATUSES.includes(status)) return { ok: false, error: "invalid_status" };
    const notes = patch.notes === undefined ? current.notes : clean(patch.notes, 2000);
    // Re-activating a cancelled booking must not double-book its slot.
    if (!ACTIVE.includes(current.status) && ACTIVE.includes(status)) {
      const s = this.getSettings();
      const n = Number(this.sql.exec(`SELECT COUNT(*) AS n FROM bookings WHERE date = ? AND time = ? AND status IN ('new','confirmed') AND id != ?`, current.date, current.time, current.id).toArray()[0].n);
      if (n >= s.perSlot) return { ok: false, error: "slot_taken" };
    }
    const row = this.sql
      .exec(`UPDATE bookings SET status = ?, notes = ?, updated_at = ? WHERE id = ? RETURNING *`, status, notes, now.toISOString(), current.id)
      .toArray()[0];
    return { ok: true, booking: shape(row) };
  }

  deleteBooking(id) {
    const rows = this.sql.exec(`DELETE FROM bookings WHERE id = ? RETURNING id`, Number(id)).toArray();
    return { ok: rows.length > 0 };
  }

  exportCsv() {
    const rows = this.sql.exec(`SELECT * FROM bookings ORDER BY date, time`).toArray();
    const cols = ["ref", "status", "date", "time", "service", "patient", "name", "phone", "email", "contact_by", "people", "insurance", "provider", "message", "notes", "created_at"];
    const cell = (v) => {
      let s = String(v ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Stop spreadsheets running formulas.
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
  }
}

function shape(r) {
  return {
    id: Number(r.id), ref: r.ref, createdAt: r.created_at, updatedAt: r.updated_at, status: r.status,
    date: r.date, time: r.time, service: r.service, patient: r.patient, name: r.name, phone: r.phone,
    email: r.email, contactBy: r.contact_by, people: r.people, insurance: r.insurance, provider: r.provider,
    message: r.message, notes: r.notes,
  };
}

// Short, readable booking reference like "CD-7K3M9Q" (no 0/O/1/I to avoid mix-ups).
function makeRef() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "CD-" + [...bytes].map((b) => chars[b % chars.length]).join("");
}
