/**
 * Source Ai — AI Readiness Snapshot backend (plain Vercel Edge Function)
 *
 * Zero-config Vercel convention — place at exactly: api/scan.js
 * Live at: https://sourceai.co.nz/api/scan
 *
 * Fetches a target website server-side and runs 7 checks:
 *   1. chat          — recognised smart/AI chat widget present
 *   2. leadcapture    — working lead-capture mechanism (form, booking, click-to-call)
 *   3. aivisibility   — robots.txt blocking AI crawlers + structured data present
 *   4. speed          — approximate load speed (response time + page weight)
 *   5. seo            — basic on-page SEO (title, meta description, H1, alt text)
 *   6. reviews        — visible review/reputation widget
 *   7. social         — links to social platforms
 *
 * Uses a realistic browser User-Agent, since some sites (Shopify
 * speed-optimizer apps, WAF/bot-protection) serve different content to
 * requests identified as bots or coming from datacenter IPs. Note: this
 * doesn't fully solve IP-reputation-based filtering — a small number of
 * heavily-protected sites may still return red/false-negative results.
 * That's a known, accepted limitation, not a bug to keep chasing.
 *
 * No third-party API keys required. Nothing is stored — each request is
 * scanned fresh.
 */

export const config = {
  runtime: "edge",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const { searchParams } = new URL(request.url);
  const target = searchParams.get("url");

  if (!target) {
    return json({ error: "missing_url" }, 400);
  }

  let targetUrl;
  try {
    targetUrl = normalizeUrl(target);
  } catch (e) {
    return json({ error: "invalid_url", domain: target }, 400);
  }

  const fetched = await fetchSite(targetUrl);

  if (!fetched.ok) {
    return json({ error: "unreachable", reachable: false, domain: target }, 200);
  }

  const robotsTxt = await fetchRobotsTxt(targetUrl);

  const checks = {
    chat: checkChat(fetched.html),
    leadcapture: checkLeadCapture(fetched.html),
    aivisibility: checkAiVisibility(fetched.html, robotsTxt),
    speed: checkSpeed(fetched.fetchTimeMs, fetched.byteLength),
    seo: checkSeo(fetched.html),
    reviews: checkReviews(fetched.html),
    social: checkSocial(fetched.html),
  };

  return json(
    {
      domain: target,
      reachable: true,
      checks,
    },
    200
  );
}

// ---------- helpers ----------

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function normalizeUrl(input) {
  let v = input.trim();
  if (!/^https?:\/\//i.test(v)) v = "https://" + v;
  const u = new URL(v); // throws on invalid input
  return u.toString();
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
  } finally {
    clearTimeout(id);
  }
}

async function fetchSite(targetUrl) {
  const attempts = [targetUrl];
  if (targetUrl.startsWith("https://")) {
    attempts.push(targetUrl.replace("https://", "http://"));
  }

  for (const attempt of attempts) {
    try {
      const start = Date.now();
      const resp = await fetchWithTimeout(attempt, 10000);
      if (resp.ok) {
        const text = await resp.text();
        const fetchTimeMs = Date.now() - start;
        const html = text.slice(0, 3000000); // cap at 3MB
        return { ok: true, html, fetchTimeMs, byteLength: text.length };
      }
    } catch (e) {
      // try the next attempt
    }
  }
  return { ok: false };
}

async function fetchRobotsTxt(targetUrl) {
  try {
    const origin = new URL(targetUrl).origin;
    const resp = await fetchWithTimeout(origin + "/robots.txt", 5000);
    if (resp.ok) {
      const text = await resp.text();
      return text.slice(0, 100000);
    }
  } catch (e) {
    // no robots.txt, or it timed out — treat as "not blocking" (absence = allowed, per spec)
  }
  return "";
}

// ---------- check: chat ----------

const CHAT_SIGNATURES = [
  { name: "Lucid Chat Agent", pattern: /app\.lucidos\.nz|smartbot\.thesource\.nz|LucidReboot/i },
  { name: "Intercom", pattern: /widget\.intercom\.io|window\.Intercom/i },
  { name: "Drift", pattern: /js\.driftt\.com/i },
  { name: "Tidio", pattern: /code\.tidio\.co/i },
  { name: "Crisp", pattern: /client\.crisp\.chat/i },
  { name: "Zendesk", pattern: /static\.zdassets\.com/i },
  { name: "LiveChat", pattern: /cdn\.livechatinc\.com/i },
  { name: "HubSpot Chat", pattern: /js\.usemessages\.com|js\.hs-scripts\.com/i },
  { name: "Tawk.to", pattern: /embed\.tawk\.to/i },
  { name: "GoHighLevel widget", pattern: /widgets\.leadconnectorhq\.com/i },
  { name: "Chatra", pattern: /call\.chatra\.io/i },
  { name: "Olark", pattern: /static\.olark\.com/i },
  { name: "Freshchat", pattern: /wchat\.freshchat\.com/i },
  { name: "ManyChat", pattern: /widget\.manychat\.com/i },
];

const MESSENGER_PLUGIN = /fb-customerchat|customer_chat/i;

function checkChat(html) {
  const matched = CHAT_SIGNATURES.filter((s) => s.pattern.test(html)).map((s) => s.name);
  if (matched.length > 0) return { status: "green", detected: matched };
  if (MESSENGER_PLUGIN.test(html)) return { status: "amber", detected: ["Facebook Messenger plugin"] };
  return { status: "red", detected: [] };
}

// ---------- check: lead capture ----------

const LEAD_PLATFORM_SIGNATURES = [
  { name: "Calendly", pattern: /calendly\.com/i },
  { name: "Acuity Scheduling", pattern: /acuityscheduling\.com/i },
  { name: "Setmore", pattern: /setmore\.com/i },
  { name: "Square Appointments", pattern: /squareup\.com\/appointments/i },
  { name: "booking widget", pattern: /link\.msgsndr\.com|leadconnectorhq\.com/i },
  { name: "Typeform", pattern: /typeform\.com/i },
  { name: "HubSpot form", pattern: /hsforms\.net|hs-forms/i },
  { name: "Contact Form 7", pattern: /wpcf7/i },
  { name: "Gravity Forms", pattern: /gravityforms|gform_wrapper/i },
  { name: "WPForms", pattern: /wpforms/i },
  { name: "JotForm", pattern: /jotform\.com/i },
  { name: "Formspree", pattern: /formspree\.io/i },
  { name: "Netlify Forms", pattern: /data-netlify/i },
];

const CONTACT_WORDS = /contact|enquir|inquir|get in touch|request a quote|message us|send (a |us a )?message|book a (call|consult)/i;

function hasContactForm(html) {
  const parts = html.split(/<form/i);
  if (parts.length <= 1) return false;
  for (let i = 1; i < parts.length; i++) {
    const before = parts[i - 1].slice(-400);
    const after = parts[i].slice(0, 800);
    if (CONTACT_WORDS.test(before) || CONTACT_WORDS.test(after)) return true;
  }
  return false;
}

function checkLeadCapture(html) {
  const found = [];
  const platformMatch = LEAD_PLATFORM_SIGNATURES.find((s) => s.pattern.test(html));
  if (platformMatch) found.push(platformMatch.name);
  if (hasContactForm(html)) found.push("contact form");
  if (/href=["']tel:/i.test(html)) found.push("click-to-call");
  if (/href=["']mailto:/i.test(html)) found.push("email link");

  const score = found.length;
  if (score >= 2) return { status: "green", detected: found };
  if (score === 1) return { status: "amber", detected: found };
  return { status: "red", detected: found };
}

// ---------- check: AI visibility ----------

const AI_BOTS = [
  "gptbot", "chatgpt-user", "oai-searchbot", "perplexitybot", "google-extended",
  "claudebot", "claude-web", "anthropic-ai", "ccbot", "cohere-ai", "bytespider", "applebot-extended",
];

function parseRobotsBlocking(robotsTxt) {
  if (!robotsTxt) return { blocked: false, blockedBots: [] };

  const lines = robotsTxt.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));

  let groupAgents = [];
  let sawRuleInGroup = false;
  const blockedBots = new Set();
  let globalBlockAll = false;

  for (const line of lines) {
    const uaMatch = line.match(/^user-agent:\s*(.+)$/i);
    if (uaMatch) {
      if (sawRuleInGroup) {
        groupAgents = [];
        sawRuleInGroup = false;
      }
      groupAgents.push(uaMatch[1].trim().toLowerCase());
      continue;
    }
    const disallowMatch = line.match(/^disallow:\s*(.*)$/i);
    if (disallowMatch) {
      sawRuleInGroup = true;
      const path = disallowMatch[1].trim();
      if (path === "/") {
        for (const agent of groupAgents) {
          if (agent === "*") globalBlockAll = true;
          if (AI_BOTS.includes(agent)) blockedBots.add(agent);
        }
      }
      continue;
    }
    if (/^(allow|crawl-delay|sitemap):/i.test(line)) sawRuleInGroup = true;
  }

  return { blocked: globalBlockAll || blockedBots.size > 0, blockedBots: Array.from(blockedBots) };
}

function hasStructuredData(html) {
  return /application\/ld\+json/i.test(html) || /itemtype=["']https?:\/\/schema\.org/i.test(html);
}

function checkAiVisibility(html, robotsTxt) {
  const robots = parseRobotsBlocking(robotsTxt);
  if (robots.blocked) {
    return { status: "red", detected: robots.blockedBots.length ? robots.blockedBots : ["robots.txt blocks all crawlers"] };
  }
  if (!hasStructuredData(html)) return { status: "amber", detected: [] };
  return { status: "green", detected: ["schema.org structured data"] };
}

// ---------- check: speed (fast approximation, not real Lighthouse) ----------

function checkSpeed(fetchTimeMs, byteLength) {
  const seconds = (fetchTimeMs / 1000).toFixed(1);
  const kb = Math.round(byteLength / 1024);
  const detail = [`${seconds}s response, ${kb}KB`];

  if (fetchTimeMs < 1500 && byteLength < 2000000) return { status: "green", detected: detail };
  if (fetchTimeMs < 3000 && byteLength < 5000000) return { status: "amber", detected: detail };
  return { status: "red", detected: detail };
}

// ---------- check: on-page SEO ----------

function checkSeo(html) {
  const found = [];

  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : "";
  if (titleText.length >= 10 && titleText.length <= 70) found.push("title tag");

  if (/<meta\s+name=["']description["']\s+content=["'][^"']{20,}/i.test(html)) found.push("meta description");

  if (/<h1[\s>]/i.test(html)) found.push("H1 heading");

  const imgTags = html.match(/<img[^>]*>/gi) || [];
  if (imgTags.length > 0) {
    const withAlt = imgTags.filter((tag) => /alt=["'][^"']+["']/i.test(tag));
    if (withAlt.length / imgTags.length >= 0.5) found.push("image alt text");
  }

  const score = found.length;
  if (score >= 3) return { status: "green", detected: found };
  if (score >= 1) return { status: "amber", detected: found };
  return { status: "red", detected: found };
}

// ---------- check: reviews & reputation ----------

const REVIEW_SIGNATURES = [
  { name: "Trustpilot", pattern: /trustpilot\.com|widget\.trustpilot\.com/i },
  { name: "Yotpo", pattern: /yotpo\.com|staticw2\.yotpo\.com/i },
  { name: "Judge.me", pattern: /judge\.me/i },
  { name: "Stamped.io", pattern: /stamped\.io/i },
  { name: "Google Reviews widget", pattern: /reviews\.googleapis\.com|google-reviews-widget|elfsight.*review/i },
];

function checkReviews(html) {
  const matched = REVIEW_SIGNATURES.filter((s) => s.pattern.test(html)).map((s) => s.name);
  if (matched.length > 0) return { status: "green", detected: matched };
  if (/aggregateRating|reviewCount/i.test(html)) return { status: "amber", detected: ["review schema markup"] };
  return { status: "red", detected: [] };
}

// ---------- check: social presence ----------

const SOCIAL_SIGNATURES = [
  { name: "Facebook", pattern: /(?:www\.)?facebook\.com\/(?!sharer|share\.php|tr\?)[a-zA-Z0-9._-]+/i },
  { name: "Instagram", pattern: /(?:www\.)?instagram\.com\/(?!p\/|reel\/)[a-zA-Z0-9._-]+/i },
  { name: "LinkedIn", pattern: /linkedin\.com\/company\/[a-zA-Z0-9._-]+/i },
  { name: "TikTok", pattern: /tiktok\.com\/@[a-zA-Z0-9._-]+/i },
];

function checkSocial(html) {
  const matched = [];
  for (const s of SOCIAL_SIGNATURES) {
    if (s.pattern.test(html)) matched.push(s.name);
  }
  if (matched.length >= 2) return { status: "green", detected: matched };
  if (matched.length === 1) return { status: "amber", detected: matched };
  return { status: "red", detected: [] };
}
