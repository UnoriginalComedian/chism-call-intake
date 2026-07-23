/**
 * Cloudflare Worker: live Google Calendar availability for the call-intake form.
 *
 * GET /availability?estimator=<name>&date=YYYY-MM-DD
 *   -> { estimator, date, slots: ["09:00","09:30",...] }  (times in America/Los_Angeles)
 *
 * GET /estimators
 *   -> { estimators: ["Mike", "Drake", ...] }              (from ESTIMATOR_CALENDARS keys)
 *
 * Auth to Google: a service account JWT, exchanged for an OAuth token, used to call
 * the Calendar API's freebusy.query. No end-user OAuth flow, no stored refresh token -
 * the service account just needs read access to each estimator's calendar (share the
 * calendar with the service account's email, "See all event details").
 *
 * Required secrets/vars (wrangler secret put / wrangler.toml [vars]):
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL   - from the service account JSON key
 *   GOOGLE_PRIVATE_KEY             - the "private_key" field from that JSON key, as-is
 *                                    (wrangler secret put handles the embedded newlines)
 *   ESTIMATOR_CALENDARS            - JSON string, e.g. {"Mike":"mike@chismbrothers.com",
 *                                    "Drake":"drake@chismbrothers.com"}
 *   ALLOWED_ORIGIN                 - e.g. "https://unoriginalcomedian.github.io"
 *   WORKING_HOURS_START            - 24h "HH:MM", e.g. "08:00"
 *   WORKING_HOURS_END              - 24h "HH:MM", e.g. "17:00"
 *   SLOT_MINUTES                   - slot length, e.g. "60"
 *   BUFFER_MINUTES                 - gap kept clear around each busy block, e.g. "15"
 *
 * See ../README.md for the full Google Cloud + Cloudflare setup walkthrough.
 */

const TIMEZONE = 'America/Los_Angeles';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    try {
      if (url.pathname === '/estimators') {
        const calendars = JSON.parse(env.ESTIMATOR_CALENDARS || '{}');
        return json({ estimators: Object.keys(calendars) }, cors);
      }

      if (url.pathname === '/availability') {
        const estimator = url.searchParams.get('estimator');
        const date = url.searchParams.get('date'); // YYYY-MM-DD
        if (!estimator || !date) {
          return json({ error: 'estimator and date query params are required' }, cors, 400);
        }

        const calendars = JSON.parse(env.ESTIMATOR_CALENDARS || '{}');
        const calendarId = calendars[estimator];
        if (!calendarId) {
          return json({ error: 'Unknown estimator: ' + estimator }, cors, 404);
        }

        const accessToken = await getGoogleAccessToken(env);
        const { timeMin, timeMax } = dayWindow(date, env);
        const busy = await getFreeBusy(accessToken, calendarId, timeMin, timeMax);
        const slots = computeSlots(date, busy, env);

        return json({ estimator, date, slots }, cors);
      }

      return json({ error: 'Not found' }, cors, 404);
    } catch (err) {
      return json({ error: err.message || String(err) }, cors, 500);
    }
  }
};

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
}

function json(body, headers, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

/* ---- Google auth: build + sign a service-account JWT, exchange for an access token ---- */

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const encHeader = base64url(JSON.stringify(header));
  const encClaims = base64url(JSON.stringify(claims));
  const signingInput = encHeader + '.' + encClaims;

  const key = await importPrivateKey(env.GOOGLE_PRIVATE_KEY);
  const signature = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = signingInput + '.' + base64url(signature);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt)
  });
  if (!res.ok) throw new Error('Google auth failed: ' + (await res.text()));
  const data = await res.json();
  return data.access_token;
}

async function importPrivateKey(pem) {
  const body = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const der = Uint8Array.from(atob(body), c => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function base64url(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let str = '';
  bytes.forEach(b => { str += String.fromCharCode(b); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/* ---- Calendar free/busy + slot math ---- */

function dayWindow(date, env) {
  const start = env.WORKING_HOURS_START || '08:00';
  const end = env.WORKING_HOURS_END || '17:00';
  return {
    timeMin: zonedISOString(date, start),
    timeMax: zonedISOString(date, end)
  };
}

/* Builds an ISO string for date+time in TIMEZONE without a full tz database -
   relies on Intl to find the current UTC offset for that zone/date. */
function zonedISOString(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offsetMinutes = getTimezoneOffsetMinutes(utcGuess, TIMEZONE);
  return new Date(utcGuess.getTime() - offsetMinutes * 60000).toISOString();
}

function getTimezoneOffsetMinutes(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map(p => [p.type, p.value]));
  const asUTC = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUTC - date.getTime()) / 60000;
}

async function getFreeBusy(accessToken, calendarId, timeMin, timeMax) {
  const res = await fetch('https://www.googleapis.com/calendar/v3/freeBusy', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + accessToken,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] })
  });
  if (!res.ok) throw new Error('Calendar freebusy failed: ' + (await res.text()));
  const data = await res.json();
  const cal = data.calendars && data.calendars[calendarId];
  return (cal && cal.busy) || [];
}

function computeSlots(date, busy, env) {
  const slotMinutes = parseInt(env.SLOT_MINUTES || '60', 10);
  const bufferMinutes = parseInt(env.BUFFER_MINUTES || '15', 10);
  const start = env.WORKING_HOURS_START || '08:00';
  const end = env.WORKING_HOURS_END || '17:00';

  const busyRanges = busy.map(b => ({ start: new Date(b.start), end: new Date(b.end) }));
  const dayStart = new Date(zonedISOString(date, start));
  const dayEnd = new Date(zonedISOString(date, end));

  const slots = [];
  for (let t = dayStart.getTime(); t + slotMinutes * 60000 <= dayEnd.getTime(); t += slotMinutes * 60000) {
    const slotStart = new Date(t - bufferMinutes * 60000);
    const slotEnd = new Date(t + slotMinutes * 60000 + bufferMinutes * 60000);
    const overlaps = busyRanges.some(b => slotStart < b.end && slotEnd > b.start);
    if (!overlaps) {
      slots.push(formatTime(new Date(t)));
    }
  }
  return slots;
}

function formatTime(date) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}
