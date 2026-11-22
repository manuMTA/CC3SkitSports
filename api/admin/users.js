// /api/admin/users — gestion des utilisateurs (administrateurs uniquement).
// Conformément à l'accord API Strava, l'administrateur ne voit PAS les activités des autres utilisateurs :
// seulement leur identité, leur groupe et l'état de leur connexion.
import { handler, requireAdmin, db, json, readBody, query, getAthlete, validToken, stravaDeauthorize, httpError, PUBLIC_ATHLETE_FIELDS } from "../_lib.js";

export default handler(["GET", "PATCH", "DELETE"], async (req, res) => {
  const adminId = requireAdmin(req);

  if (req.method === "GET") {
    const users = await db(`athletes?select=${PUBLIC_ATHLETE_FIELDS}&order=created_at.desc`);
    return json(res, 200, { users, me: adminId });
  }

  if (req.method === "PATCH") {
    const { id, group_name } = await readBody(req);
    if (!Number(id)) throw httpError(400, "Identifiant manquant.");
    await db(`athletes?id=eq.${Number(id)}`, { method: "PATCH", body: { group_name: String(group_name || "").trim().slice(0, 40) } });
    return json(res, 200, { ok: true });
  }

  // DELETE ?id=… : retire l'accès Strava de l'utilisateur et supprime ses données.
  const id = Number(query(req).id);
  if (!id) throw httpError(400, "Identifiant manquant.");
  const athlete = await getAthlete(id);
  if (athlete) {
    try { await stravaDeauthorize(await validToken(athlete)); } catch (e) { console.error(e); }
    await db(`athletes?id=eq.${id}`, { method: "DELETE" });
  }
  json(res, 200, { ok: true });
});
