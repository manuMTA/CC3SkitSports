// /api/auth/<action> — connexion par e-mail ou par Strava.
//   POST register  : créer un compte e-mail + mot de passe
//   POST login     : se connecter avec e-mail + mot de passe
//   POST logout    : se déconnecter
//   GET  strava    : partir vers Strava (connexion, ou liaison si déjà connecté)
//   GET  callback  : retour de Strava
import {
  handler, json, redirect, readBody, query, env, appUrl, stravaEnabled, randomToken, setCookie, parseCookies,
  startSession, endSession, sessionUserId, getUser, getUserBy, db, normEmail, checkPasswordRules,
  hashPassword, verifyPassword, publicUser, stravaToken, syncUser, httpError,
} from "../_lib.js";

const actions = {
  async register(req, res) {
    const b = await readBody(req);
    const email = normEmail(b.email);
    checkPasswordRules(b.password);
    const firstname = String(b.firstname || "").trim().slice(0, 60);
    const lastname = String(b.lastname || "").trim().slice(0, 60);
    if (!firstname) throw httpError(400, "Indiquez votre prénom.");
    if (await getUserBy("email", email)) throw httpError(409, "Un compte existe déjà avec cette adresse. Connectez-vous.");
    const rows = await db("users?select=*", {
      method: "POST",
      prefer: "return=representation",
      body: { email, password_hash: hashPassword(b.password), firstname, lastname },
    });
    startSession(res, rows[0].id);
    json(res, 200, { user: publicUser(rows[0]) });
  },

  async login(req, res) {
    const b = await readBody(req);
    let email;
    try { email = normEmail(b.email); } catch { throw httpError(401, "E-mail ou mot de passe incorrect."); }
    const u = await getUserBy("email", email);
    // Délai fixe : ralentit les essais de mots de passe en série.
    await new Promise(r => setTimeout(r, 400));
    if (!u || !verifyPassword(b.password, u.password_hash)) throw httpError(401, "E-mail ou mot de passe incorrect.");
    startSession(res, u.id);
    json(res, 200, { user: publicUser(u) });
  },

  async logout(req, res) {
    endSession(res);
    json(res, 200, { ok: true });
  },

  async strava(req, res) {
    if (!stravaEnabled()) return redirect(res, "/?erreur=strava_off");
    const state = randomToken();
    setCookie(res, "oauth_state", state, 600);
    const qs = new URLSearchParams({
      client_id: env("STRAVA_CLIENT_ID"),
      redirect_uri: `${appUrl()}/api/auth/callback`,
      response_type: "code",
      approval_prompt: "auto",
      scope: "read,activity:read_all",
      state,
    });
    redirect(res, `https://www.strava.com/oauth/authorize?${qs}`);
  },

  async callback(req, res) {
    const q = query(req);
    const expected = parseCookies(req).oauth_state;
    setCookie(res, "oauth_state", "", 0);
    if (q.error) return redirect(res, "/?erreur=refus");
    if (!q.code || !q.state || q.state !== expected) return redirect(res, "/?erreur=etat");
    const scopes = String(q.scope || "").split(",");
    if (!scopes.includes("activity:read_all") && !scopes.includes("activity:read")) return redirect(res, "/?erreur=scope");

    let t;
    try { t = await stravaToken({ code: q.code, grant_type: "authorization_code" }); }
    catch (e) { return redirect(res, e.publicMessage === "capacity" ? "/?erreur=capacite" : "/?erreur=strava"); }
    const a = t.athlete || {};
    const stravaFields = {
      strava_id: a.id, access_token: t.access_token, refresh_token: t.refresh_token,
      expires_at: t.expires_at, scope: scopes.join(","),
      profile: a.profile_medium || a.profile || "",
    };

    const current = await getUser(sessionUserId(req));
    const owner = await getUserBy("strava_id", a.id);
    let user;
    if (current) {
      // Déjà connecté (compte e-mail) : on lie Strava à ce compte.
      if (owner && owner.id !== current.id) return redirect(res, "/?erreur=deja_lie");
      await db(`users?id=eq.${current.id}`, { method: "PATCH", body: { ...stravaFields, city: current.city || a.city || "" } });
      user = await getUser(current.id);
    } else if (owner) {
      await db(`users?id=eq.${owner.id}`, { method: "PATCH", body: stravaFields });
      user = await getUser(owner.id);
    } else {
      const rows = await db("users?select=*", {
        method: "POST",
        prefer: "return=representation",
        body: { ...stravaFields, firstname: a.firstname || "", lastname: a.lastname || "", city: a.city || "" },
      });
      user = rows[0];
    }
    startSession(res, user.id);
    if (!user.last_sync) {
      try { await syncUser(user, { maxPages: 3 }); } catch (e) { console.error("première synchro", e); }
    }
    redirect(res, "/");
  },
};

export default handler(["GET", "POST"], async (req, res) => {
  const name = query(req).action;
  const fn = actions[name];
  if (!fn) return json(res, 404, { error: "Action inconnue" });
  const isGet = name === "strava" || name === "callback";
  if ((req.method === "GET") !== isGet) return json(res, 405, { error: "Méthode non autorisée" });
  await fn(req, res);
});
