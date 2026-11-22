// /api/admin — réservé aux administrateurs.
//   GET                          liste des utilisateurs
//   GET ?athlete=<uuid>          fiche d'un adhérent + ses séances saisies ou importées
//                                (les séances synchronisées depuis Strava restent privées : règles de l'API Strava)
//   PATCH { id, group_name }     changer le groupe
//   POST  { action:"reset_password", id }  génère un mot de passe provisoire
//   DELETE ?id=<uuid>            retirer un utilisateur (accès Strava révoqué, données effacées)
import {
  handler, json, readBody, query, requireAdmin, db, getUser, httpError, isUuid, publicUser,
  hashPassword, randomToken, stravaDeauthorize, validToken, ACTIVITY_FIELDS,
} from "./_lib.js";

export default handler(["GET", "PATCH", "POST", "DELETE"], async (req, res) => {
  const admin = await requireAdmin(req);
  const q = query(req);

  if (req.method === "GET" && q.athlete) {
    const u = await getUser(q.athlete);
    if (!u) throw httpError(404, "Utilisateur introuvable.");
    const activities = await db(`activities?user_id=eq.${u.id}&source=neq.strava&select=${ACTIVITY_FIELDS}&order=start_date.desc&limit=5000`);
    const stravaCount = await db(`activities?user_id=eq.${u.id}&source=eq.strava&select=id&limit=5000`);
    return json(res, 200, { user: publicUser(u), activities, hiddenStrava: stravaCount.length });
  }

  if (req.method === "GET") {
    const users = await db(`users?select=*&order=created_at.desc`);
    return json(res, 200, { users: users.map(publicUser), me: admin.id });
  }

  if (req.method === "PATCH") {
    const { id, group_name } = await readBody(req);
    if (!isUuid(id)) throw httpError(400, "Identifiant manquant.");
    await db(`users?id=eq.${id}`, { method: "PATCH", body: { group_name: String(group_name || "").trim().slice(0, 40) } });
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST") {
    const b = await readBody(req);
    if (b.action !== "reset_password" || !isUuid(b.id)) throw httpError(400, "Requête invalide.");
    const u = await getUser(b.id);
    if (!u || !u.email) throw httpError(400, "Cet utilisateur n'a pas de compte e-mail (connexion par Strava uniquement).");
    const temp = randomToken(9).replace(/[-_]/g, "x");
    await db(`users?id=eq.${u.id}`, { method: "PATCH", body: { password_hash: hashPassword(temp) } });
    return json(res, 200, { password: temp });
  }

  // DELETE
  const id = q.id;
  if (!isUuid(id)) throw httpError(400, "Identifiant manquant.");
  if (id === admin.id) throw httpError(400, "Vous ne pouvez pas retirer votre propre compte ici.");
  const u = await getUser(id);
  if (u) {
    if (u.strava_id) { try { await stravaDeauthorize(await validToken(u)); } catch (e) { console.error(e); } }
    await db(`users?id=eq.${id}`, { method: "DELETE" });
  }
  json(res, 200, { ok: true });
});
