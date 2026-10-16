# Booking page

One-page appointment request site. Static files live in `public/` and are served by Cloudflare Workers (`wrangler.jsonc`).

Booking requests are sent by email through FormSubmit. The destination address is in the form's `action` in `public/index.html`.
