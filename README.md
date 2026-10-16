# Booking page

A one-page appointment request site with a four-step booking form. Requests are emailed straight to the inbox, with tap-to-call and tap-to-text buttons in every email.

## How it works

| Part | Where |
|---|---|
| Page (HTML, CSS, JavaScript) | `public/index.html` |
| Booking form options, shared with the Worker | `public/booking-options.json` |
| Email sender (Cloudflare Worker) | `worker/index.js` |
| Tests | `worker/index.test.mjs` |

**The form never loses a request.** When someone presses *Send request*:

1. The page sends it to its own Worker (`/api/book`), which emails it through Resend.
2. If the Worker's email isn't set up or fails, the page sends it through the backup service (FormSubmit) to `BACKUP_EMAIL` in `public/index.html`.
3. If both fail, the visitor gets a one-tap button that texts the request, already written out, to the phone number. Their answers are also saved in the browser, so a refresh doesn't wipe them.

**Spam protection:** a hidden honeypot field, a minimum fill time, a limit of 5 requests per visitor per minute, an origin check, and optional Cloudflare Turnstile.

## Set up email (free)

1. Create a free account at [resend.com](https://resend.com) using the email address that should receive bookings, and create an API key.
2. In Cloudflare, open **Workers & Pages → testingg → Settings → Variables and Secrets** and add these as **Secret**:

   | Name | Value |
   |---|---|
   | `RESEND_API_KEY` | the API key from Resend |
   | `BOOKING_TO_EMAIL` | the email that receives bookings (the one the Resend account uses) |
   | `BOOKING_FROM_EMAIL` | `Booking page <onboarding@resend.dev>` |

3. Open `/api/health` on the site. It should show `"email": true`.

Without your own domain, Resend only delivers to the email address the account was created with, which is exactly what this page needs.

## Change where bookings go

- **Main route:** change the `BOOKING_TO_EMAIL` secret in Cloudflare.
- **Backup route:** change `BACKUP_EMAIL` near the top of the script in `public/index.html`. The first request to a new address triggers a one-time *Activate Form* email from FormSubmit that must be clicked.

## Commands

```bash
npm test        # run the Worker tests
npm run dev     # local preview with the Worker
```

Pushing to `main` deploys automatically through Cloudflare.
