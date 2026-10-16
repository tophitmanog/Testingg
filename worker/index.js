// Cloudflare Worker entry point.
//
// Static files in public/ are served directly; this script runs for /api/* (see wrangler.jsonc).
// Bookings and settings live in a SQLite-backed Durable Object, created automatically on deploy.
// See worker/app.js for the settings (secrets) to add in the Cloudflare dashboard.

import { DurableObject } from "cloudflare:workers";
import { handle } from "./app.js";
import { Store } from "./store.js";

export class BookingStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.store = new Store(ctx.storage.sql);
  }
  availability() { return this.store.availability(); }
  createBooking(data) { return this.store.createBooking(data); }
  listBookings(filter) { return this.store.listBookings(filter); }
  stats() { return this.store.stats(); }
  updateBooking(id, patch) { return this.store.updateBooking(id, patch); }
  deleteBooking(id) { return this.store.deleteBooking(id); }
  exportCsv() { return this.store.exportCsv(); }
  getSettings() { return this.store.getSettings(); }
  saveSettings(input) { return this.store.saveSettings(input); }
}

export default {
  fetch: (request, env) => handle(request, env),
};
