// Fonctions partagées par les routes /api (les fichiers commençant par "_" ne sont pas exposés par Vercel).
import crypto from "node:crypto";

/* ---------- Configuration ---------- */
export function env(name) {
  const v = process.env[name];
  if (!v) throw httpError(500, `Variable d'environnement manquante : ${name}`);
  return v;
}
const STRAVA_OAUTH = "https://www.strava.com/oauth";
const stravaApi = () => (process.env.STRAVA_API_BASE || "https://www.strava.com/api/v3").replace(/\/$/, "");
export const appUrl = () => env("APP_URL").replace(/\/$/, "");

export function httpError(status, publicMessage) {
  const e = new Error(publicMessage);
  e.status = status;
  e.publicMessage = publicMessage;
  return e;
}

/* ---------- Réponses ---------- */
export function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(data));
}
export function redirect(res, location) {
  res.statusCode = 302;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}
export function handler(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) return json(res, 405, { error: "Méthode non autorisée" });
      await fn(req, res);
    } catch (e) {
      console.error(e);
      json(res, e.status || 500, { error: e.publicMessage || "Erreur serveur. Réessayez dans un instant." });
    }
  };
}
export async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { return {}; }
}
export function query(req) {
  if (req.query) return req.query;
  return Object.fromEntries(new URL(req.url, "http://x").searchParams);
}

/* ---------- Cookies & session signée ---------- */
export function parseCookies(req) {
  const out = {};
  (req.headers.cookie || "").split(";").forEach(p => {
    const i = p.indexOf("=");
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export function setCookie(res, name, value, maxAgeSec) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${maxAgeSec}`];
  if (appUrl().startsWith("https://")) parts.push("Secure");
  const prev = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [...(Array.isArray(prev) ? prev : prev ? [prev] : []), parts.join("; ")]);
}
const sign = v => crypto.createHmac("sha256", env("SESSION_SECRET")).update(v).digest("base64url");
function safeEqual(a, b) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function startSession(res, athleteId) {
  const exp = Date.now() + 30 * 86400 * 1000;
  const v = `${athleteId}.${exp}`;
  setCookie(res, "sid", `${v}.${sign(v)}`, 30 * 86400);
}
export function endSession(res) { setCookie(res, "sid", "", 0); }
export function sessionAthleteId(req) {
  const raw = parseCookies(req).sid;
  if (!raw) return null;
  const [id, exp, sig] = raw.split(".");
  if (!id || !exp || !sig) return null;
  if (!safeEqual(sig, sign(`${id}.${exp}`)) || Number(exp) < Date.now()) return null;
  return Number(id);
}
export function requireSession(req) {
  const id = sessionAthleteId(req);
  if (!id) throw httpError(401, "Session expirée : reconnectez-vous avec Strava.");
  return id;
}
export function isAdmin(athleteId) {
  return (process.env.ADMIN_STRAVA_IDS || "").split(",").map(s => s.trim()).filter(Boolean).includes(String(athleteId));
}
export function requireAdmin(req) {
  const id = requireSession(req);
  if (!isAdmin(id)) throw httpError(403, "Accès réservé aux administrateurs.");
  return id;
}
export const randomToken = () => crypto.randomBytes(24).toString("base64url");

/* ---------- Supabase (API REST, clé service côté serveur uniquement) ---------- */
export async function db(path, { method = "GET", body, prefer } = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(`${env("SUPABASE_URL").replace(/\/$/, "")}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      // Nouvelle clé secrète (sb_secret_…) : en-tête apikey seul. Ancienne clé service_role (JWT) : aussi en Bearer.
      ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }),
      "Content-Type": "application/json",
      ...(prefer ? { Prefer: prefer } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) {
    console.error("Supabase", r.status, text);
    throw httpError(500, "Erreur de base de données.");
  }
  return text ? JSON.parse(text) : null;
}
export async function getAthlete(id) {
  const rows = await db(`athletes?id=eq.${Number(id)}&select=*`);
  return rows[0] || null;
}

/* ---------- Strava ---------- */
export async function stravaToken(params) {
  const r = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env("STRAVA_CLIENT_ID"), client_secret: env("STRAVA_CLIENT_SECRET"), ...params }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("Strava token", r.status, data);
    if (r.status === 403 && JSON.stringify(data).includes("limit")) throw httpError(403, "capacity");
    throw httpError(r.status === 400 || r.status === 401 ? 401 : 502, "Connexion Strava refusée.");
  }
  return data;
}
export async function validToken(athlete) {
  if (athlete.expires_at * 1000 > Date.now() + 120000) return athlete.access_token;
  const t = await stravaToken({ grant_type: "refresh_token", refresh_token: athlete.refresh_token });
  await db(`athletes?id=eq.${athlete.id}`, {
    method: "PATCH",
    body: { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at },
  });
  athlete.access_token = t.access_token;
  athlete.refresh_token = t.refresh_token;
  athlete.expires_at = t.expires_at;
  return t.access_token;
}
export async function stravaGet(token, path) {
  const r = await fetch(`${stravaApi()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) throw httpError(429, "Limite de requêtes Strava atteinte. Réessayez dans 15 minutes.");
  if (r.status === 401) throw httpError(401, "Accès Strava expiré ou retiré : reconnectez-vous.");
  if (r.status === 404) return null;
  if (!r.ok) { console.error("Strava", r.status, await r.text()); throw httpError(502, "Strava ne répond pas correctement. Réessayez plus tard."); }
  return r.json();
}
export async function stravaDeauthorize(token) {
  try {
    await fetch(`${STRAVA_OAUTH}/deauthorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `access_token=${encodeURIComponent(token)}`,
    });
  } catch (e) { console.error("deauthorize", e); }
}
export function activityRow(a, athleteId) {
  return {
    id: a.id,
    athlete_id: athleteId,
    start_date: a.start_date,
    start_date_local: a.start_date_local || a.start_date,
    sport_type: a.sport_type || a.type || "",
    name: String(a.name || "").slice(0, 200),
    distance: a.distance || 0,
    moving_time: a.moving_time || 0,
    elapsed_time: a.elapsed_time || 0,
    elevation: a.total_elevation_gain || 0,
    avg_hr: a.average_heartrate || null,
  };
}
export async function upsertActivities(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await db("activities?on_conflict=id", {
      method: "POST",
      body: rows.slice(i, i + 500),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
}

/**
 * Récupère les nouvelles activités d'un athlète.
 * - Première synchro : les plus récentes d'abord, jusqu'à maxPages × 200 activités.
 * - Ensuite : seulement celles postérieures à la dernière activité connue.
 */
export async function syncAthlete(athlete, { maxPages = 5 } = {}) {
  const token = await validToken(athlete);
  const last = await db(`activities?athlete_id=eq.${athlete.id}&select=start_date&order=start_date.desc&limit=1`);
  const after = last[0] ? Math.floor(new Date(last[0].start_date).getTime() / 1000) - 1 : null;
  let added = 0;
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ per_page: "200", page: String(page) });
    if (after) qs.set("after", String(after));
    const list = await stravaGet(token, `/athlete/activities?${qs}`);
    if (!Array.isArray(list) || !list.length) break;
    await upsertActivities(list.map(a => activityRow(a, athlete.id)));
    added += list.length;
    if (list.length < 200) break;
  }
  await db(`athletes?id=eq.${athlete.id}`, { method: "PATCH", body: { last_sync: new Date().toISOString() } });
  return added;
}

/* Champs d'un athlète renvoyés au navigateur (jamais les jetons). */
export const PUBLIC_ATHLETE_FIELDS = "id,firstname,lastname,city,profile,group_name,created_at,last_sync";
