// =====================================================================
// SuiviTri — fonction serveur « strava » (Supabase Edge Function, Deno)
//
//  POST {action:"login", code}          → connexion avec Strava, renvoie un jeton de session
//  POST {action:"link", code}           → relie Strava à un compte e-mail déjà connecté
//  POST {action:"sync", athlete_id?}    → récupère les activités récentes (utilisateur connecté)
//  GET  ?hub.mode=subscribe…            → validation du webhook Strava
//  POST {object_type, aspect_type…}     → événement webhook (nouvelle activité)
//
// Déployer SANS vérification JWT (le webhook et la connexion n'ont pas de jeton) :
//   supabase functions deploy strava --no-verify-jwt
// La fonction vérifie elle-même le jeton de l'utilisateur pour "sync".
// =====================================================================
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string, d = "") => Deno.env.get(k) ?? d;
const STRAVA_CLIENT_ID = env("STRAVA_CLIENT_ID");
const STRAVA_CLIENT_SECRET = env("STRAVA_CLIENT_SECRET");
const STRAVA_VERIFY_TOKEN = env("STRAVA_VERIFY_TOKEN");
const STRAVA_SUBSCRIPTION_ID = env("STRAVA_SUBSCRIPTION_ID"); // optionnel, renseigné après création du webhook
const STRAVA_API = env("STRAVA_API_BASE", "https://www.strava.com/api/v3");
const STRAVA_OAUTH = env("STRAVA_OAUTH_BASE", "https://www.strava.com/oauth");
const COACH_IDS = env("COACH_STRAVA_IDS").split(",").map((s) => s.trim()).filter(Boolean);
const FIRST_SYNC_DAYS = 14;

// Clé secrète : nouvelle clé (SUPABASE_SECRET_KEYS) si disponible, sinon l'ancienne service_role
function secretKey(): string {
  try {
    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS", "{}"));
    if (keys.default) return keys.default;
  } catch (_) { /* ignore */ }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}
const admin = createClient(env("SUPABASE_URL"), secretKey(), { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Tâche en arrière-plan (réponse immédiate à Strava, traitement ensuite)
function background(p: Promise<unknown>) {
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch((e) => console.error(e)));
  else p.catch((e) => console.error(e));
}

// ---------------------------------------------------------------- Strava
async function stravaToken(params: Record<string, string>) {
  const r = await fetch(`${STRAVA_OAUTH}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: STRAVA_CLIENT_ID, client_secret: STRAVA_CLIENT_SECRET, ...params }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error("Strava OAuth : " + (data?.message || r.status));
  return data;
}

async function accessTokenFor(userId: string): Promise<string> {
  const { data: t, error } = await admin.from("strava_tokens").select("*").eq("user_id", userId).single();
  if (error || !t) throw new Error("Compte Strava non relié");
  if (t.expires_at > Date.now() / 1000 + 120) return t.access_token;
  const n = await stravaToken({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  await admin.from("strava_tokens").update({
    access_token: n.access_token, refresh_token: n.refresh_token, expires_at: n.expires_at, updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return n.access_token;
}

async function stravaGet(token: string, path: string) {
  const r = await fetch(STRAVA_API + path, { headers: { Authorization: `Bearer ${token}` } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`Strava ${path} : ${r.status}`);
  return r.json();
}

// ---------------------------------------------------------------- Zones
const ZONES = ["Z1", "Z2", "Z3"] as const;
type Acc = { t: number; hr: number; hrN: number; pw: number; pwN: number; dist: number };

function sportOf(t: string): string | null {
  t = (t || "").toLowerCase();
  if (/swim/.test(t)) return "swim";
  if (/ride|bike|cycl|velomobile|handcycle/.test(t)) return "bike";
  if (/run/.test(t)) return "run";
  if (/weight|workout|crossfit|hiit|pilates|yoga|training|core/.test(t)) return "strength";
  return null;
}
const zoneOf = (hr: number, z1: number, z2: number) => (!hr ? null : hr <= z1 ? "Z1" : hr <= z2 ? "Z2" : "Z3");
const emptyAcc = () => Object.fromEntries(ZONES.map((z) => [z, { t: 0, hr: 0, hrN: 0, pw: 0, pwN: 0, dist: 0 }])) as Record<string, Acc>;
const hm = (sec: number) => Math.floor(sec / 3600) + ":" + String(Math.round((sec % 3600) / 60)).padStart(2, "0");

function pace(sport: string, sec: number, dist: number) {
  if (!dist || !sec) return "";
  const mmss = (p: number) => Math.floor(p / 60) + ":" + String(Math.round(p % 60)).padStart(2, "0");
  if (sport === "swim") return mmss(sec / (dist / 100)) + "/100 m";
  if (sport === "run") return mmss(sec / (dist / 1000)) + "/km";
  if (sport === "bike") return (dist / 1000 / (sec / 3600)).toFixed(1) + " km/h";
  return "";
}

function zonesFromStreams(s: any, z1: number, z2: number) {
  const time: number[] = s?.time?.data || [];
  const hr: number[] = s?.heartrate?.data || [];
  const w: number[] = s?.watts?.data || [];
  const d: number[] = s?.distance?.data || [];
  const acc = emptyAcc();
  let noHr = 0, dur = 0;
  for (let i = 0; i < time.length - 1; i++) {
    const dt = time[i + 1] - time[i];
    if (dt <= 0 || dt > 30) continue; // pauses ignorées
    const zn = zoneOf(hr[i], z1, z2) ?? (noHr += dt, "Z1");
    const a = acc[zn];
    a.t += dt; dur += dt;
    if (hr[i]) { a.hr += hr[i] * dt; a.hrN += dt; }
    if (w[i]) { a.pw += w[i] * dt; a.pwN += dt; }
    if (d.length) a.dist += Math.max(0, (d[i + 1] ?? 0) - (d[i] ?? 0));
  }
  return { acc, dur, noHr: dur > 0 && noHr > dur * 0.5 };
}

function zonesFromSummary(a: any, z1: number, z2: number) {
  const acc = emptyAcc();
  const dur = a.moving_time || a.elapsed_time || 0;
  const zn = zoneOf(a.average_heartrate, z1, z2) ?? "Z1";
  acc[zn].t = dur;
  if (a.average_heartrate) { acc[zn].hr = a.average_heartrate * dur; acc[zn].hrN = dur; }
  if (a.average_watts) { acc[zn].pw = a.average_watts * dur; acc[zn].pwN = dur; }
  acc[zn].dist = a.distance || 0;
  return { acc, dur, noHr: !a.average_heartrate };
}

const emptyBilan = () => ({
  zones: Object.fromEntries(ZONES.map((z) => [z, { time: "", fc: "", pw: "" }])), rpe: "", comment: "",
});
// Séance réalisée = validée (ou ancienne donnée avec un bilan saisi, sans préremplissage)
const bilanDone = (b: any) => b?.validated === true ||
  (b?.validated === undefined && !b?.prefilled && ZONES.some((z) => (b?.zones?.[z]?.time || "").trim() !== ""));

// ---------------------------------------------------------------- Import d'une activité
async function importActivity(userId: string, activityId: number, token?: string) {
  token = token || await accessTokenFor(userId);
  const a = await stravaGet(token, `/activities/${activityId}`);
  if (!a) return { id: activityId, result: "introuvable" };
  const sport = sportOf(a.sport_type || a.type);
  if (!sport) return { id: activityId, name: a.name, result: "type non géré" };

  const { data: p } = await admin.from("profiles").select("hr_z1, hr_z2, params").eq("id", userId).single();
  // Limites FC par sport à partir du profil (FC seuil, sinon 90 % de la FC max), sinon valeurs par défaut
  const sp = (p?.params || {})[sport] || {};
  const fcs = +sp.fcs > 0 ? +sp.fcs : (+sp.fcmax > 0 ? Math.round(+sp.fcmax * 0.9) : 0);
  const z1 = fcs ? Math.round(fcs * 0.85) : (p?.hr_z1 ?? 145);
  const z2 = fcs ? fcs : (p?.hr_z2 ?? 165);

  let calc = null as null | ReturnType<typeof zonesFromSummary>;
  try {
    const st = await stravaGet(token, `/activities/${activityId}/streams?keys=time,heartrate,watts,distance&key_by_type=true`);
    if (st?.time?.data?.length > 1) calc = zonesFromStreams(st, z1, z2);
  } catch (_) { /* repli sur le résumé */ }
  if (!calc || calc.dur < 60) calc = zonesFromSummary(a, z1, z2);

  const bilan = emptyBilan() as any;
  bilan.validated = true; bilan.validatedAt = new Date().toISOString(); bilan.source = "strava";
  for (const z of ZONES) {
    const x = calc.acc[z];
    if (!x.t) continue;
    bilan.zones[z] = {
      time: hm(x.t),
      fc: x.hrN ? String(Math.round(x.hr / x.hrN)) : "",
      pw: sport === "bike" && x.pwN ? Math.round(x.pw / x.pwN) + " W" : pace(sport, x.t, x.dist),
    };
  }
  const note = `Strava : ${a.name}` + (calc.noHr ? " (FC absente : temps placé en Z1)" : "");
  const date = String(a.start_date_local || a.start_date).slice(0, 10);

  // 1) déjà importée → mise à jour des temps, on garde RPE et commentaire
  const { data: existing } = await admin.from("sessions").select("id, bilan").eq("strava_activity_id", a.id).maybeSingle();
  if (existing) {
    bilan.rpe = existing.bilan?.rpe || ""; bilan.comment = existing.bilan?.comment || note;
    await admin.from("sessions").update({ bilan }).eq("id", existing.id);
    return { id: a.id, name: a.name, date, result: "mise à jour" };
  }
  // 2) séance prévue le même jour, même sport, sans bilan → on la complète
  const { data: planned } = await admin.from("sessions").select("id, bilan, title")
    .eq("athlete_id", userId).eq("date", date).eq("sport", sport).is("strava_activity_id", null);
  const target = (planned || []).find((s) => !bilanDone(s.bilan));
  if (target) {
    bilan.rpe = target.bilan?.rpe || "";
    bilan.comment = [target.bilan?.comment, note].filter(Boolean).join("\n");
    await admin.from("sessions").update({ bilan, strava_activity_id: a.id }).eq("id", target.id);
    return { id: a.id, name: a.name, date, result: `bilan ajouté à « ${target.title || sport} »` };
  }
  // 3) sinon : nouvelle séance réalisée
  bilan.comment = note;
  await admin.from("sessions").insert({ athlete_id: userId, date, sport, title: a.name, blocks: [], bilan, strava_activity_id: a.id });
  return { id: a.id, name: a.name, date, result: "séance créée" };
}

async function syncUser(userId: string) {
  const token = await accessTokenFor(userId);
  const { data: p } = await admin.from("profiles").select("last_sync").eq("id", userId).single();
  const since = p?.last_sync ? Math.floor(new Date(p.last_sync).getTime() / 1000) - 86400
    : Math.floor(Date.now() / 1000) - FIRST_SYNC_DAYS * 86400;
  const list = await stravaGet(token, `/athlete/activities?after=${since}&per_page=50`) || [];
  const report = [];
  for (const act of list) {
    try { report.push(await importActivity(userId, act.id, token)); }
    catch (e) { report.push({ id: act.id, name: act.name, result: "erreur : " + (e as Error).message }); }
  }
  await admin.from("profiles").update({ last_sync: new Date().toISOString() }).eq("id", userId);
  return report;
}

// ---------------------------------------------------------------- Connexion avec Strava
async function saveTokens(userId: string, tok: any) {
  await admin.from("strava_tokens").upsert({
    user_id: userId, access_token: tok.access_token, refresh_token: tok.refresh_token,
    expires_at: tok.expires_at, updated_at: new Date().toISOString(),
  });
}
const athleteName = (ath: any) => [ath.firstname, ath.lastname].filter(Boolean).join(" ") || `Athlète ${ath.id}`;

async function login(code: string) {
  const tok = await stravaToken({ grant_type: "authorization_code", code });
  const ath = tok.athlete;
  if (!ath?.id) throw new Error("Réponse Strava sans athlète");
  const isCoach = COACH_IDS.includes(String(ath.id));
  let email: string;

  let { data: prof } = await admin.from("profiles").select("*").eq("strava_id", ath.id).maybeSingle();
  if (prof) {
    // compte existant (créé avec Strava ou par e-mail puis relié) : on récupère son adresse
    const { data: u } = await admin.auth.admin.getUserById(prof.id);
    email = u?.user?.email || `strava-${ath.id}@athletes.example.com`;
    if (isCoach && prof.role !== "coach") await admin.from("profiles").update({ role: "coach", approved: true }).eq("id", prof.id);
  } else {
    email = `strava-${ath.id}@athletes.example.com`; // adresse technique, aucun e-mail n'est envoyé
    const name = athleteName(ath);
    const { data: created, error } = await admin.auth.admin.createUser({ email, email_confirm: true, user_metadata: { strava_id: ath.id, name } });
    let uid = created?.user?.id;
    if (error) { // déjà présent dans Auth (profil supprimé entre-temps)
      const { data: link } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      uid = link?.user?.id;
      if (!uid) throw error;
    }
    const { data: up, error: e2 } = await admin.from("profiles").upsert({
      id: uid, strava_id: ath.id, name, role: isCoach ? "coach" : "athlete", approved: isCoach,
    }).select().single();
    if (e2) throw e2;
    prof = up;
  }
  await saveTokens(prof.id, tok);

  const { data: link, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (le || !link?.properties?.hashed_token) throw le || new Error("Lien de session impossible");
  background(syncUser(prof.id));
  return { token_hash: link.properties.hashed_token };
}

// Relier Strava à un compte créé par e-mail (utilisateur déjà connecté)
async function linkStrava(userId: string, code: string) {
  const tok = await stravaToken({ grant_type: "authorization_code", code });
  const ath = tok.athlete;
  const { data: other } = await admin.from("profiles").select("id").eq("strava_id", ath.id).maybeSingle();
  if (other && other.id !== userId) throw new Error("Ce compte Strava est déjà relié à un autre utilisateur");
  const upd: Record<string, unknown> = { strava_id: ath.id };
  if (COACH_IDS.includes(String(ath.id))) { upd.role = "coach"; upd.approved = true; }
  await admin.from("profiles").update(upd).eq("id", userId);
  await saveTokens(userId, tok);
  background(syncUser(userId));
  return { ok: true, name: athleteName(ath) };
}

async function currentUser(req: Request) {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const { data: u, error } = await admin.auth.getUser(jwt);
  if (error || !u?.user) return null;
  const { data: me } = await admin.from("profiles").select("id, role, approved").eq("id", u.user.id).single();
  return me;
}

// ---------------------------------------------------------------- Serveur HTTP
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);

  // Validation du webhook par Strava
  if (req.method === "GET" && url.searchParams.get("hub.mode") === "subscribe") {
    if (url.searchParams.get("hub.verify_token") !== STRAVA_VERIFY_TOKEN) return json({ error: "jeton invalide" }, 403);
    return json({ "hub.challenge": url.searchParams.get("hub.challenge") });
  }
  if (req.method !== "POST") return json({ error: "méthode non autorisée" }, 405);

  let body: any = {};
  try { body = await req.json(); } catch (_) { return json({ error: "JSON invalide" }, 400); }

  try {
    // Événement webhook Strava
    if (body.object_type) {
      if (STRAVA_SUBSCRIPTION_ID && String(body.subscription_id) !== STRAVA_SUBSCRIPTION_ID) return json({ ok: true });
      const { data: prof } = await admin.from("profiles").select("id").eq("strava_id", body.owner_id).maybeSingle();
      if (prof) {
        if (body.object_type === "activity" && (body.aspect_type === "create" || body.aspect_type === "update")) {
          background(importActivity(prof.id, body.object_id));
        } else if (body.object_type === "activity" && body.aspect_type === "delete") {
          background(admin.from("sessions").delete().eq("strava_activity_id", body.object_id).eq("athlete_id", prof.id).eq("blocks", "[]"));
        } else if (body.object_type === "athlete" && body.updates?.authorized === "false") {
          background(admin.from("strava_tokens").delete().eq("user_id", prof.id));
        }
      }
      return json({ ok: true });
    }

    if (body.action === "login") {
      if (!body.code) return json({ error: "code manquant" }, 400);
      return json(await login(body.code));
    }

    if (body.action === "link") {
      const me = await currentUser(req);
      if (!me) return json({ error: "non connecté" }, 401);
      if (!body.code) return json({ error: "code manquant" }, 400);
      return json(await linkStrava(me.id, body.code));
    }

    if (body.action === "sync") {
      const me = await currentUser(req);
      if (!me) return json({ error: "non connecté" }, 401);
      if (!me.approved && me.role !== "coach") return json({ error: "compte en attente de validation" }, 403);
      const target = me.role === "coach" && body.athlete_id ? body.athlete_id : me.id;
      return json({ report: await syncUser(target) });
    }

    return json({ error: "action inconnue" }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: (e as Error).message || "erreur" }, 500);
  }
});
