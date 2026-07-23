# Calendar Availability Backend (Cloudflare Worker)

Serves live free/busy slots for the 3 estimators to the dynamic call-intake form. Code is
written and ready in `calendar-availability.js` — it just needs your Google Cloud + Cloudflare
accounts to actually deploy. Nobody can build this without account access, so here's exactly
what to do when you're ready.

## 1. Google Cloud — one-time setup (~10 min)

1. Go to https://console.cloud.google.com, create a new project (e.g. "CBP Calendar API").
2. **APIs & Services → Enable APIs** → enable "Google Calendar API".
3. **APIs & Services → Credentials → Create Credentials → Service Account.** Name it anything
   (e.g. "calendar-availability-worker"). Skip granting it project roles - it doesn't need any.
4. Open the new service account → **Keys → Add Key → Create new key → JSON**. This downloads a
   JSON file - keep it private, it's a credential.
5. From that JSON file you need two values for later: `client_email` and `private_key`.
6. For **each of the 3 estimators' Google Calendars**: open Google Calendar → that calendar's
   settings → **Share with specific people** → add the `client_email` from step 5 → permission
   **"See all event details"**. (You said you and Mariana already have edit access to all three
   calendars, so you can do this yourself for each one.)

No OAuth consent screen, no end-user login flow - the service account reads the calendars
directly once shared, which is why this works without a "login with Google" step in the form.

## 2. Cloudflare — one-time setup (~5 min)

1. Sign up free at https://dash.cloudflare.com (free tier covers this easily - it's a handful
   of requests a day).
2. Install the CLI: `npm install -g wrangler`
3. `wrangler login` (opens a browser to authorize the CLI with your new account).
4. From this `worker/` directory:
   ```
   wrangler secret put GOOGLE_SERVICE_ACCOUNT_EMAIL
   # paste the client_email from the JSON key when prompted

   wrangler secret put GOOGLE_PRIVATE_KEY
   # paste the private_key from the JSON key when prompted (include the
   # -----BEGIN/END PRIVATE KEY----- lines - wrangler handles the newlines)

   wrangler secret put ESTIMATOR_CALENDARS
   # paste something like: {"Mike":"mike@chismbrothers.com","Drake":"drake@chismbrothers.com","Matt":"mattk@chismbrothers.com"}
   # (use each estimator's actual calendar ID - usually their Google account email)
   ```
5. `wrangler deploy` - this prints your live Worker URL, e.g.
   `https://chism-calendar-availability.<your-subdomain>.workers.dev`

## 3. Tell me the Worker URL

Once deployed, give me that URL and I'll wire it into the dynamic intake form's availability
picker (the 3-path form itself still needs to be built - see the main plan doc for the field
sets for the "Returning customer" and "Issue on current project" paths, drafted and waiting on
your review).

## What this does NOT do (by design, matches your "keep it free" preference)

- No YouCanBookMe, no paid scheduling service.
- No public-facing booking page yet (out of scope per the original prompt doc - internal
  call-takers only, for now).
- No stored OAuth tokens or refresh-token babysitting - the service account just reads calendars
  it's been shared with, indefinitely, with no expiring consent to manage.
