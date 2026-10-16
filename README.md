# Booking site · Charisma Dental with Stephanie

A one-page website where patients pick a real appointment time, plus a private dashboard where bookings are managed. Runs entirely on Cloudflare's free plan.

## What's included

**Website** (`public/`)
- Warm, editorial design with a live "open now" status and the next available time.
- Four-step booking: visit type → date and time (calendar with open slots) → details → confirm.
- Booked times disappear immediately, so nobody can double-book.
- Confirmation screen with a booking reference, plus *Add to calendar* and *Google Calendar* links.
- Answers are saved in the browser while booking, so a refresh doesn't lose them.

**Backend** (`worker/`)
- A Cloudflare Worker with a built-in SQLite database (a Durable Object) that stores every booking. Cloudflare creates the database automatically on the first deploy.
- Branded email for each new booking, with Call / Text / Email buttons and a link to the dashboard.
- Optional confirmation email to patients (needs a domain verified in Resend).
- Spam protection: hidden honeypot field, minimum fill time, rate limits, origin checks. Security headers in `public/_headers`.

**Dashboard** (`/admin/`)
- Password-protected.
- Bookings grouped by day, with New / Confirmed / Completed / Cancelled status, notes, search, filters and a spreadsheet (CSV) download.
- Availability: weekly hours, visit length, bookings per slot, how far ahead people can book, minimum notice, and days off.

## Setup in Cloudflare

Open **Workers & Pages → testingg → Settings → Variables and Secrets** and add these as **Secret**:

| Name | Value | Needed for |
|---|---|---|
| `ADMIN_PASSWORD` | A long password of your choice | The dashboard |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) (free) | Booking emails |
| `BOOKING_TO_EMAIL` | The email that receives bookings (the one the Resend account uses) | Booking emails |
| `BOOKING_FROM_EMAIL` | `Booking page <onboarding@resend.dev>` | Booking emails |
| `CONFIRM_PATIENTS` | `true` (only after verifying your own domain in Resend) | Optional patient emails |

Check `/api/health` on the site: it shows whether email and the dashboard are set up.

Bookings are saved even before email is set up. You'll see them in the dashboard.

## Project layout

| Path | What it is |
|---|---|
| `public/index.html`, `public/css/site.css`, `public/js/` | Website and booking flow |
| `public/admin/`, `public/css/admin.css`, `public/js/admin.js` | Dashboard |
| `public/booking-options.json` | Visit types and form choices, shared with the backend |
| `worker/app.js` | API routes, sign-in and emails |
| `worker/store.js` | Database, availability rules and validation |
| `worker/index.js` | Worker entry point and the database (Durable Object) |
| `worker/index.test.mjs` | Tests |

## Commands

```bash
npm test        # run the tests
npm run dev     # local preview
```

Pushing to `main` deploys automatically through Cloudflare.
