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
export const stravaEnabled = () => !!(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET);

export function httpError(status, publicMessage) {
  const e = new Error(publicMessage);
  e.status = status;
  e.publicMessage = publicMessage;
  return e;
}

/* ---------- Requêtes / réponses ---------- */
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
export const isUuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ""));

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
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
export function startSession(res, userId) {
  const exp = Date.now() + 30 * 86400 * 1000;
  const v = `${userId}.${exp}`;
  setCookie(res, "sid", `${v}.${sign(v)}`, 30 * 86400);
}
export function endSession(res) { setCookie(res, "sid", "", 0); }
export function sessionUserId(req) {
  const raw = parseCookies(req).sid;
  if (!raw) return null;
  const [id, exp, sig] = raw.split(".");
  if (!isUuid(id) || !exp || !sig) return null;
  if (!safeEqual(sig, sign(`${id}.${exp}`)) || Number(exp) < Date.now()) return null;
  return id;
}
export function requireSession(req) {
  const id = sessionUserId(req);
  if (!id) throw httpError(401, "Session expirée : reconnectez-vous.");
  return id;
}
const listEnv = name => (process.env[name] || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
export function isAdminUser(u) {
  if (!u) return false;
  return (u.email && listEnv("ADMIN_EMAILS").includes(u.email.toLowerCase())) ||
         (u.strava_id && listEnv("ADMIN_STRAVA_IDS").includes(String(u.strava_id)));
}
export async function requireAdmin(req) {
  const u = await getUser(requireSession(req));
  if (!isAdminUser(u)) throw httpError(403, "Accès réservé aux administrateurs.");
  return u;
}
export const randomToken = (n = 24) => crypto.randomBytes(n).toString("base64url");

/* ---------- Mots de passe (scrypt, sans dépendance) ---------- */
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}
export function verifyPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, salt, hash] = stored.split("$");
  const test = crypto.scryptSync(String(pw), Buffer.from(salt, "base64"), 64, { N: 16384, r: 8, p: 1 });
  const ref = Buffer.from(hash, "base64");
  return ref.length === test.length && crypto.timingSafeEqual(ref, test);
}
export function checkPasswordRules(pw) {
  if (typeof pw !== "string" || pw.length < 8) throw httpError(400, "Le mot de passe doit contenir au moins 8 caractères.");
  if (pw.length > 200) throw httpError(400, "Mot de passe trop long.");
}
export function normEmail(e) {
  const v = String(e || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || v.length > 200) throw httpError(400, "Adresse e-mail invalide.");
  return v;
}

/* ---------- Supabase (API REST, clé secrète côté serveur uniquement) ---------- */
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
    if (r.status === 409 || text.includes("23505")) throw httpError(409, "Cette valeur existe déjà.");
    throw httpError(500, "Erreur de base de données.");
  }
  return text ? JSON.parse(text) : null;
}
export async function getUser(id) {
  if (!isUuid(id)) return null;
  const rows = await db(`users?id=eq.${id}&select=*`);
  return rows[0] || null;
}
export async function getUserBy(field, value) {
  const rows = await db(`users?${field}=eq.${encodeURIComponent(value)}&select=*`);
  return rows[0] || null;
}
/* Champs d'un utilisateur renvoyés au navigateur (jamais les jetons ni le mot de passe). */
export function publicUser(u) {
  return {
    id: u.id, email: u.email || "", firstname: u.firstname, lastname: u.lastname, city: u.city,
    profile: u.profile, group_name: u.group_name, created_at: u.created_at, last_sync: u.last_sync,
    strava_id: u.strava_id || null, has_strava: !!u.strava_id, has_password: !!u.password_hash,
  };
}
export const ACTIVITY_FIELDS = "id,strava_id,source,start_date_local,sport_type,name,distance,moving_time,elevation,avg_hr";

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
    if (r.status === 403 && JSON.stringify(data).toLowerCase().includes("limit")) throw httpError(403, "capacity");
    throw httpError(r.status === 400 || r.status === 401 ? 401 : 502, "Connexion Strava refusée.");
  }
  return data;
}
export async function validToken(user) {
  if (!user.strava_id || !user.refresh_token) throw httpError(400, "Aucun compte Strava n'est lié.");
  if (user.expires_at * 1000 > Date.now() + 120000) return user.access_token;
  const t = await stravaToken({ grant_type: "refresh_token", refresh_token: user.refresh_token });
  await db(`users?id=eq.${user.id}`, {
    method: "PATCH",
    body: { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at },
  });
  Object.assign(user, { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at });
  return t.access_token;
}
export async function stravaGet(token, path) {
  const r = await fetch(`${stravaApi()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 429) throw httpError(429, "Limite de requêtes Strava atteinte. Réessayez dans 15 minutes.");
  if (r.status === 401) throw httpError(401, "Accès Strava expiré ou retiré : reconnectez Strava.");
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
/* Retire le lien Strava d'un utilisateur : révoque l'accès et efface les activités venues de l'API Strava. */
export async function unlinkStrava(user, { revoke = true } = {}) {
  if (revoke) { try { await stravaDeauthorize(await validToken(user)); } catch (e) { console.error(e); } }
  await db(`activities?user_id=eq.${user.id}&source=eq.strava`, { method: "DELETE" });
  await db(`users?id=eq.${user.id}`, {
    method: "PATCH",
    body: { strava_id: null, access_token: null, refresh_token: null, expires_at: null, scope: "", last_sync: null },
  });
}
export function activityRow(a, userId) {
  return {
    strava_id: a.id,
    user_id: userId,
    source: "strava",
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
export async function upsertByStravaId(rows) {
  for (let i = 0; i < rows.length; i += 500) {
    await db("activities?on_conflict=strava_id", {
      method: "POST",
      body: rows.slice(i, i + 500),
      prefer: "resolution=merge-duplicates,return=minimal",
    });
  }
}

/**
 * Récupère les nouvelles activités Strava d'un utilisateur.
 * Première synchro : les plus récentes d'abord (maxPages × 200). Ensuite : seulement les nouvelles.
 */
export async function syncUser(user, { maxPages = 5 } = {}) {
  const token = await validToken(user);
  const last = await db(`activities?user_id=eq.${user.id}&source=eq.strava&select=start_date&order=start_date.desc&limit=1`);
  const after = last[0] ? Math.floor(new Date(last[0].start_date).getTime() / 1000) - 1 : null;
  let added = 0;
  for (let page = 1; page <= maxPages; page++) {
    const qs = new URLSearchParams({ per_page: "200", page: String(page) });
    if (after) qs.set("after", String(after));
    const list = await stravaGet(token, `/athlete/activities?${qs}`);
    if (!Array.isArray(list) || !list.length) break;
    await upsertByStravaId(list.map(a => activityRow(a, user.id)));
    added += list.length;
    if (list.length < 200) break;
  }
  await db(`users?id=eq.${user.id}`, { method: "PATCH", body: { last_sync: new Date().toISOString() } });
  return added;
}
