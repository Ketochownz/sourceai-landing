/**
 * Source Ai — AI Readiness Snapshot lead capture (plain Vercel Edge Function)
 *
 * Zero-config Vercel convention — place at exactly:
 *
 *   api/lead.js
 *
 * Live at: https://sourceai.co.nz/api/lead (once deployed)
 *
 * Receives the "email me this report" submission from the Snapshot page,
 * validates it, and forwards it server-side to a GHL Inbound Webhook.
 *
 * This exists as a separate server-side hop (rather than posting straight
 * from the browser to GHL) so the GHL webhook URL stays server-side only
 * (an env var, never shipped to the client), and to avoid relying on GHL's
 * webhook endpoint handling browser CORS preflight correctly.
 *
 * Setup: same GHL workflow you already built for the lucid-os version —
 * just point GHL_WEBHOOK_URL (in this project's Vercel env vars) at the
 * same webhook URL, or build a fresh workflow if this should route
 * differently than the lucid-os one did.
 */

export const config = {
  runtime: "edge",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ error: "invalid_json" }, 400);
  }

  const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
  const email = typeof body.email === "string" ? body.email.trim().slice(0, 200) : "";

  if (!name || !isValidEmail(email)) {
    return json({ error: "invalid_input" }, 400);
  }

  const webhookUrl = process.env.GHL_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("GHL_WEBHOOK_URL is not set");
    return json({ ok: false, error: "webhook_not_configured" }, 200);
  }

  const payload = {
    name,
    email,
    domain: typeof body.domain === "string" ? body.domain.slice(0, 200) : "",
    chat_status: pickStatus(body.chat_status),
    leadcapture_status: pickStatus(body.leadcapture_status),
    aivisibility_status: pickStatus(body.aivisibility_status),
    issue_count: typeof body.issue_count === "number" ? body.issue_count : null,
    recommended_plan: typeof body.recommended_plan === "string" ? body.recommended_plan.slice(0, 100) : "",
    source: "ai-readiness-snapshot",
    submitted_at: new Date().toISOString(),
  };

  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error("GHL webhook forward failed", err);
    return json({ ok: false, error: "webhook_failed" }, 200);
  }

  return json({ ok: true }, 200);
}

// ---------- helpers ----------

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function isValidEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function pickStatus(v) {
  return v === "green" || v === "amber" || v === "red" ? v : "";
}
