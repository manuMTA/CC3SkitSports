// GET /api/auth/callback — retour de Strava : échange du code, création du compte, première synchro.
import { handler, query, parseCookies, setCookie, redirect, stravaToken, db, startSession, syncAthlete, getAthlete } from "../_lib.js";

export default handler(["GET"], async (req, res) => {
  const q = query(req);
  const expected = parseCookies(req).oauth_state;
  setCookie(res, "oauth_state", "", 0);
  if (q.error) return redirect(res, "/?erreur=refus");
  if (!q.code || !q.state || q.state !== expected) return redirect(res, "/?erreur=etat");
  const scopes = String(q.scope || "").split(",");
  if (!scopes.includes("activity:read_all") && !scopes.includes("activity:read")) return redirect(res, "/?erreur=scope");

  let t;
  try {
    t = await stravaToken({ code: q.code, grant_type: "authorization_code" });
  } catch (e) {
    return redirect(res, e.publicMessage === "capacity" ? "/?erreur=capacite" : "/?erreur=strava");
  }
  const a = t.athlete || {};
  await db("athletes?on_conflict=id", {
    method: "POST",
    prefer: "resolution=merge-duplicates,return=minimal",
    body: {
      id: a.id,
      firstname: a.firstname || "",
      lastname: a.lastname || "",
      city: a.city || "",
      profile: a.profile_medium || a.profile || "",
      access_token: t.access_token,
      refresh_token: t.refresh_token,
      expires_at: t.expires_at,
      scope: scopes.join(","),
    },
  });
  startSession(res, a.id);

  // Première synchronisation (limitée pour rester rapide ; la suite se fait depuis le tableau de bord).
  try {
    const athlete = await getAthlete(a.id);
    if (athlete && !athlete.last_sync) await syncAthlete(athlete, { maxPages: 3 });
  } catch (e) { console.error("première synchro", e); }

  redirect(res, "/");
});
