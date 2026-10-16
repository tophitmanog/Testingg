<div align="center">

# Charisma Dental · with Stephanie

**An online booking site where patients pick a real appointment time, plus a private dashboard to manage every booking.**

Real-time availability · Booking database · Staff dashboard · Branded email notifications · Runs on Cloudflare's free plan

[**Live site**](https://testingg.punisherog.workers.dev/) · [**Dashboard**](https://testingg.punisherog.workers.dev/admin/) · [Setup](#setup) · [How it works](#how-it-works) · [API](#api-reference)

<br>

<img src="docs/screenshots/banner.jpg" alt="The booking site on a laptop and a phone" width="100%">

</div>

---

## Contents

- [What it does](#what-it-does)
- [Tour of the website](#tour-of-the-website)
- [The booking flow](#the-booking-flow)
- [The dashboard](#the-dashboard)
- [Booking emails](#booking-emails)
- [On phones](#on-phones)
- [How it works](#how-it-works)
- [Tech stack](#tech-stack)
- [Setup](#setup)
- [Running it locally](#running-it-locally)
- [API reference](#api-reference)
- [Data and privacy](#data-and-privacy)
- [Security](#security)
- [Project structure](#project-structure)
- [Handing over](#handing-over)
- [Design notes](#design-notes)
- [Project history](#project-history)

---

## What it does

| For patients | For Stephanie |
|---|---|
| See open times in a calendar and pick one, seven days a week | Every booking is saved in a database and listed in a private dashboard |
| Book in four short steps on any device | An email for each new booking, with one-tap **Call**, **Text** and **Email** buttons |
| Booked times disappear instantly, so there's no double-booking | Mark bookings **New → Confirmed → Completed** or **Cancelled**, and add notes |
| A booking reference plus **Add to calendar** and **Google Calendar** links | Set weekly hours, visit length, notice period and days off, with no code |
| A clear "call now" prompt for toothaches and emergencies | Search, filter and download everything as a spreadsheet |
| Their answers are kept if the page is refreshed mid-booking | Urgent requests are flagged in the email subject |

---

## Tour of the website

The site is a single, calm page in a warm "boutique" style: cream and sage with terracotta accents, and elegant serif headings.

### Hero

The top bar shows whether the clinic is **open right now** (always in Toronto time, wherever the visitor is), and the hero shows the **next available appointment**, read live from the booking database.

<img src="docs/screenshots/home-hero.jpg" alt="Hero section with headline, booking buttons and next available time" width="100%">

### Services

A numbered list of what can be booked. On desktop, the photo changes as you hover each row. Each arrow jumps to the booking form with that visit already selected.

<img src="docs/screenshots/home-services.jpg" alt="Numbered list of services with a photo" width="100%">

### About Stephanie

A short personal introduction and the three things that make booking with her different.

<img src="docs/screenshots/home-about.jpg" alt="About section with an introduction from Stephanie" width="100%">

### Families and FAQ

<img src="docs/screenshots/home-families.jpg" alt="Family booking banner" width="100%">

<img src="docs/screenshots/home-faq.jpg" alt="Frequently asked questions" width="100%">

The page also has a **Visit** section with a map, address, directions link and opening hours (today's row is highlighted), and a footer with contact details and a **Staff login** link.

<img src="docs/screenshots/home-footer.jpg" alt="Footer" width="100%">

---

## The booking flow

Four steps, with a summary panel on the left that fills in as the patient goes.

| | |
|---|---|
| **1 · Visit**<br>Choose the type of visit and whether they're new or returning. Picking *Toothache or emergency* shows a prompt to call. | <img src="docs/screenshots/booking-1-visit.jpg" alt="Step 1: choose a visit" width="520"> |
| **2 · Date and time**<br>A calendar of the next 30 days. Days with open times have a dot. Times are grouped into morning, afternoon and evening. Only genuinely open times are shown. | <img src="docs/screenshots/booking-2-time.jpg" alt="Step 2: calendar and time slots" width="520"> |
| **3 · Details**<br>Name and phone are required. Email is optional, unless they want an email reply. Also: how to contact them, number of people, insurance and a note. | <img src="docs/screenshots/booking-3-details.jpg" alt="Step 3: patient details" width="520"> |
| **4 · Confirm**<br>A review of everything, each line with an **Edit** link, then a consent checkbox. | <img src="docs/screenshots/booking-4-confirm.jpg" alt="Step 4: review and confirm" width="520"> |
| **Booked**<br>A booking reference, plus **Add to calendar** (an `.ics` file) and **Google Calendar** links. | <img src="docs/screenshots/booking-5-booked.jpg" alt="Booking confirmed" width="520"> |

**If something goes wrong:**
- If someone else takes the same time a moment earlier, the patient is sent back to the calendar with fresh times and a short message.
- If the booking can't be sent at all, a **Text my booking instead** button opens their messages app with the booking already written out.

---

## The dashboard

Private, password-protected, at [`/admin/`](https://testingg.punisherog.workers.dev/admin/). It works on phones too.

<img src="docs/screenshots/dashboard-login.jpg" alt="Dashboard sign-in" width="100%">

### Bookings

- Counters for **new (to confirm)**, **today**, **upcoming** and **all time**.
- Bookings grouped by day, showing **Upcoming**, **Past** or **All**, with a status filter and search by name, phone, email or reference.
- Open a booking to **Call**, **Text** or **Email** in one tap, read their note, add your own notes and change its status.
- **Download spreadsheet** exports every booking as a CSV file that opens in Excel or Google Sheets.
- The list refreshes itself every minute, and the browser tab shows the number of new bookings.

<img src="docs/screenshots/dashboard-bookings.jpg" alt="Dashboard bookings list" width="100%">

### Availability

All availability is controlled from here, with no code changes:

| Setting | What it does | Default |
|---|---|---|
| Weekly hours | Open or closed per day, with start and end times | Mon–Fri 9am–9pm, Sat–Sun 8am–6pm |
| Visit length | Length of each time slot (15–90 minutes) | 30 minutes |
| Bookings per time slot | How many people can book the same time | 1 |
| Book up to | How many days ahead people can book | 30 days |
| Minimum notice | No bookings sooner than this | 3 hours |
| Days off | Specific dates with no bookings, e.g. holidays | None |

<img src="docs/screenshots/dashboard-availability.jpg" alt="Dashboard availability settings" width="100%">

---

## Booking emails

Each new booking sends a branded email styled like the website. It has **Call**, **Text** and **Email** buttons, all the details, the patient's note and an **Open dashboard** link. Replying to it goes straight to the patient when they gave an email address. Emergencies get **URGENT** in the subject.

<p align="center"><img src="docs/screenshots/email-new-booking.jpg" alt="New booking email" width="460"></p>

Patients can also get a confirmation email once a domain is verified. See [`CONFIRM_PATIENTS`](#setup).

---

## On phones

The site is designed for phones first. A **Call / Book a time** bar stays at the bottom of the screen, buttons and inputs are large enough to tap easily, and nothing scrolls sideways.

<p align="center">
<img src="docs/screenshots/mobile-home.jpg" alt="Home page on a phone" width="260">&nbsp;&nbsp;
<img src="docs/screenshots/mobile-booking.jpg" alt="Booking calendar on a phone" width="260">&nbsp;&nbsp;
<img src="docs/screenshots/mobile-dashboard.jpg" alt="Dashboard on a phone" width="260">
</p>

---

## How it works

```mermaid
flowchart LR
  P[Patient's browser] -->|"pages, images"| A[(Cloudflare static assets)]
  P -->|"GET /api/availability<br>POST /api/bookings"| W[Cloudflare Worker]
  S[Stephanie's dashboard] -->|"/api/admin/*<br>signed-in only"| W
  W <-->|"read / write"| D[(Booking database<br>SQLite Durable Object)]
  W -->|"new booking email"| R[Resend] --> E[Stephanie's inbox]
```

1. The page and images are static files served from Cloudflare's network.
2. The booking calendar asks the Worker for open times (`/api/availability`). The Worker works them out from the availability settings, removing past times, times inside the notice period and times already booked.
3. When a patient confirms, the Worker validates everything again and checks the slot is still free. Then it saves the booking and sends the email.
4. The database is a **SQLite-backed Durable Object**. All bookings go through one instance, which handles one request at a time, so two people can never book the same slot.
5. The dashboard signs in with a password and gets a secure, signed cookie that lasts 14 days. Changing the password signs everyone out.

---

## Tech stack

| Part | Built with |
|---|---|
| Website | Hand-written HTML, CSS and JavaScript, with no framework or build step |
| Fonts | [Fraunces](https://fonts.google.com/specimen/Fraunces) (headings) and [DM Sans](https://fonts.google.com/specimen/DM+Sans) (text), from Google Fonts |
| Hosting | [Cloudflare Workers](https://developers.cloudflare.com/workers/) with [Static Assets](https://developers.cloudflare.com/workers/static-assets/) |
| Backend | A Cloudflare Worker (`worker/`), plain JavaScript |
| Database | [Durable Objects with SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/), created automatically on deploy |
| Rate limiting | [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) |
| Email | [Resend](https://resend.com) |
| Deploys | [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/): every push to `main` goes live automatically |
| Tests | Node's built-in test runner and in-memory SQLite (`node:test`, `node:sqlite`) |
| Map | Google Maps embed |
| Photos | Illustrative, AI-generated images (see [Design notes](#design-notes)) |

There are **no npm dependencies**.

**Running cost:** $0 on Cloudflare's and Resend's free plans. Resend's free plan allows 3,000 emails a month. A custom domain is optional and costs about $15–25 a year.

---

## Setup

The site deploys automatically from this repository through Cloudflare (Workers Builds, production branch `main`, deploy command `npx wrangler deploy`). The database and rate limiters are declared in [`wrangler.jsonc`](wrangler.jsonc) and created on the first deploy.

Add these in **Cloudflare → Workers & Pages → testingg → Settings → Variables and Secrets**. Select **Production**, and choose type **Secret** for each one:

| Name | Value | Needed for |
|---|---|---|
| `ADMIN_PASSWORD` | A long password | The dashboard |
| `RESEND_API_KEY` | API key from [resend.com](https://resend.com) with *Sending access* | Booking emails |
| `BOOKING_TO_EMAIL` | Where booking emails go (comma-separate several) | Booking emails |
| `BOOKING_FROM_EMAIL` | `Booking page <onboarding@resend.dev>` | Booking emails |
| `CONFIRM_PATIENTS` | `true` | Optional patient confirmations, once a domain is verified in Resend |

Without a verified domain, Resend only delivers to the email address the Resend account was created with. Use that address for `BOOKING_TO_EMAIL`.

**Check the setup:** open [`/api/health`](https://testingg.punisherog.workers.dev/api/health). It should show `"email": true` and `"admin": true`.

Bookings are saved even before email is set up. They always appear in the dashboard.

---

## Running it locally

Needs Node.js 22 or newer.

```bash
npm test        # run the test suite (17 tests)
npm run dev     # local preview with the Worker and database (wrangler dev)
```

For local secrets, create a `.dev.vars` file (it's already ignored by git):

```ini
ADMIN_PASSWORD=choose-a-local-password
```

**The tests cover:**
- availability: opening hours, notice period, slot length, days off, Toronto time
- double-booking protection, including restoring a cancelled booking
- validation, spam traps and other-site requests
- dashboard sign-in, signed cookies and signing out when the password changes
- status changes, notes, deletion and CSV export, including protection against spreadsheet formulas
- email content and HTML escaping

---

## API reference

### Public

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/availability` | Open times for the booking window: `{ timeZone, slotMinutes, days: [{ date, times[] }] }` |
| `POST` | `/api/bookings` | Create a booking (JSON). Returns `{ ok, booking: { ref, date, time, … } }` |
| `GET` | `/api/health` | `{ ok, email, admin }`: whether email and the dashboard are set up |

`POST /api/bookings` body:

```json
{
  "service": "Check-up & cleaning",
  "patient": "New patient",
  "date": "2026-10-19",
  "time": "11:00",
  "name": "Hannah Wright",
  "phone": "416-555-0142",
  "email": "hannah@example.com",
  "contactBy": "Text",
  "people": "2 people",
  "insurance": "Yes",
  "provider": "Sun Life",
  "message": "Me and my daughter (9) if possible",
  "consent": true
}
```

Allowed values for `service`, `patient`, `people`, `insurance` and `contactBy` are listed in [`public/booking-options.json`](public/booking-options.json).

**Responses:**

| Status | Meaning |
|---|---|
| `200` | Booked |
| `409` | The time was just taken |
| `422` | Invalid fields (`fields` lists them) |
| `429` | Too many attempts |
| `403` | Sent from another website |

### Dashboard (signed in)

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/admin/login` | `{ password }` → sets the session cookie |
| `POST` | `/api/admin/logout` | Clears the session |
| `GET` | `/api/admin/session` | `200` if signed in |
| `GET` | `/api/admin/bookings?view=upcoming\|past\|all&status=&q=` | Bookings and counters |
| `PATCH` | `/api/admin/bookings/:id` | `{ status?, notes? }` |
| `DELETE` | `/api/admin/bookings/:id` | Permanently delete a booking |
| `GET` | `/api/admin/export.csv` | All bookings as a spreadsheet |
| `GET` / `PUT` | `/api/admin/settings` | Read or save availability settings |

---

## Data and privacy

Each booking stores:
- a reference, status and timestamps
- the date, time and visit type
- new or returning patient
- name, phone and optional email
- preferred contact method, number of people, insurance and provider
- the patient's note and Stephanie's notes

**Not stored:**
- payment details
- health records
- IP addresses (they're only used briefly for rate limiting)

The form asks people **not** to include private medical details. Bookings can be deleted at any time from the dashboard. Data stays in the Cloudflare account that hosts the site.

---

## Security

- **Dashboard sign-in:**
  - password checked with a constant-time comparison
  - session cookie signed with HMAC-SHA-256, set `HttpOnly`, `Secure` and `SameSite=Strict`, and limited to `/api/admin`
  - expires after 14 days, and changing the password signs everyone out
- **Rate limits:** 5 bookings and 5 sign-in attempts per minute per IP address.
- **Other websites:** requests that change data are rejected when they come from another website (Origin check).
- **Spam:** a hidden honeypot field and a minimum fill time. Bots get a fake success and nothing is saved.
- **Validation:** every field is checked on the server against fixed lists, with length limits and phone and email checks. The server also re-checks the slot itself.
- **Emails:** everything a patient types is HTML-escaped.
- **CSV export:** cells starting with `=`, `+`, `-` or `@` are neutralised so spreadsheets can't run them as formulas.
- **Security headers** ([`public/_headers`](public/_headers)):
  - a strict Content-Security-Policy (no inline scripts), HSTS, `nosniff`, Referrer-Policy and Permissions-Policy
  - `frame-ancestors 'none'`
  - the dashboard is marked `noindex` so search engines don't list it

---

## Project structure

```
.
├── public/                     Static site, served by Cloudflare
│   ├── index.html              The website and booking flow
│   ├── admin/index.html        The dashboard
│   ├── css/site.css            Website styles (design tokens at the top)
│   ├── css/admin.css           Dashboard styles
│   ├── js/site.js              Open/closed status, menu, services photo, animations
│   ├── js/booking.js           Booking flow: calendar, validation, sending, calendar links
│   ├── js/admin.js             Dashboard: sign-in, bookings, availability
│   ├── booking-options.json    Visit types and choices (shared with the Worker)
│   ├── img/                    Photos (WebP)
│   └── _headers                Security headers
├── worker/
│   ├── index.js                Worker entry point and the database (Durable Object)
│   ├── app.js                  API routes, sign-in, emails
│   ├── store.js                Database tables, availability rules, validation
│   └── index.test.mjs          Tests
├── docs/screenshots/           Images used in this README
├── wrangler.jsonc              Cloudflare config: assets, database, rate limits
└── package.json                Scripts (no dependencies)
```

---

## Handing over

When Stephanie takes it over:

- [ ] Delete test bookings in the dashboard.
- [ ] Set her weekly hours and days off in **Availability**.
- [ ] Add a real photo of Stephanie for the About section and the booking panel (the "SP" initials are a placeholder).
- [ ] She creates a free Resend account with her own email. Update `RESEND_API_KEY` and `BOOKING_TO_EMAIL`.
- [ ] Set a new `ADMIN_PASSWORD` just for her.
- [ ] Confirm with the clinic that using the Charisma Dental name and address is fine.
- [ ] Optional: a custom domain such as `bookwithstephanie.ca`, verified in Resend, then set `CONFIRM_PATIENTS=true`.

---

## Design notes

- **Palette:** cream `#f7f1e8`, paper `#fffdf9`, sage `#8aa592`, forest `#2f4a3a`, terracotta `#c2734f`, ink `#1f2a24`. All colours are CSS variables at the top of `public/css/site.css`.
- **Type:** Fraunces for headings, with italic terracotta accents; DM Sans for text.
- **Motion:** gentle fade-ins, a slow scrolling strip and a rotating badge. All of it turns off for visitors who prefer reduced motion.
- **Accessibility:**
  - keyboard-friendly controls with visible focus outlines and a skip link
  - labelled form fields, error messages tied to their fields, and announcements for screen readers
  - good colour contrast and large tap targets
- **Photos:** the photos in `public/img/` are **AI-generated illustrations** made for this design. They don't show the real clinic, its staff or its patients. Replace them with real photos before relying on the site publicly.

<p>
<img src="public/img/studio.webp" alt="" width="130">
<img src="public/img/smile.webp" alt="" width="173">
<img src="public/img/stilllife.webp" alt="" width="173">
<img src="public/img/kids.webp" alt="" width="173">
<img src="public/img/family.webp" alt="" width="173">
</p>

---

## Project history

| Version | What changed |
|---|---|
| 1 | One-page booking request site, with requests emailed through a free form service |
| 2 | Four-step request form, a Worker email sender with backups, and a colourful redesign |
| **3** | **Rebuilt:** warm boutique design, real time-slot booking, booking database, staff dashboard, branded emails |

<div align="center">
<br>
<sub>Charisma Dental · 9000 Jane Street, Concord, ON L4K 0M6 · 647-629-6061</sub>
</div>
