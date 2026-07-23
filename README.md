# Chism Brothers Painting — Call Intake

Internal, mobile-friendly form for Mariana to log phone-call leads. One page,
self-contained (`index.html`, no build step), hosted the same way as
[chism-call-script](https://unoriginalcomedian.github.io/chism-call-script/)
and [ChismCine](https://chismcine.com) — GitHub Pages serving straight off `main`.

## What it does today

Fills in caller/job/notes fields, then on submit:
- Builds the exact **Deal Name** and **two-line Summary** format used by the
  live "Website Leads (bid@)" Zap (`JC ZAP -` marker), swapped to "Phone lead".
- Shows a **Copy Summary** button — paste straight into the Deal in Pipeline CRM
  if the Zapier automation isn't wired up yet.
- Offers a **Download JSON** copy of the full submission as a fallback record.
- If `WEBHOOK_URL` (top of the `<script>` in `index.html`) is set to a Zapier
  "Catch Hook" URL, it also POSTs the JSON payload there automatically.

## Wiring the automation

1. Build/duplicate the Zap per `~/.claude/plans/replicated-sprouting-engelbart.md`
   and the `cbp-lead-email-zap` skill (duplicate Zap 373507152).
2. Trigger = **Webhooks by Zapier → Catch Hook**. Copy the custom webhook URL
   it gives you.
3. Paste that URL into `WEBHOOK_URL` in `index.html`, commit, push. Pages
   redeploys automatically.
4. The JSON payload already includes everything the Create Person / Create
   Deal / Calendar / Drive / SMS steps need: `first_name`, `last_name`, `phone`,
   `email`, `job_site_address`, `job_type_label` + `job_type_id`, `source_label`
   + `source_id`, `project_notes`, `lead_date`, `deal_name`, `deal_summary`,
   `schedule_estimate` (+ `estimate_date`/`estimate_time`/`estimator_name`),
   `save_to_drive`, `send_sms`.

## Field ID reference

Job type and source IDs are hard-coded in `index.html` from
`~/.claude/skills/jobtread-pipeline-crm/SKILL.md` (2026-07-21 snapshot) — re-check
`list_enabled_zapier_actions` before wiring the Zap in case they've changed.

## Open items (see the plan doc)

- Confirm Mariana's exact field wording once she's used this.
- SMS provider (RingCentral recommended, needs OAuth) vs Twilio.
- Real Google Calendar + estimator list (currently free-text).
- Target Drive folder for the "save summary" toggle.
