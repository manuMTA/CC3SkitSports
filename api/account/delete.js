// POST /api/account/delete — l'utilisateur retire l'accès Strava et supprime toutes ses données.
import { handler, requireSession, getAthlete, validToken, stravaDeauthorize, db, endSession, json } from "../_lib.js";

export default handler(["POST"], async (req, res) => {
  const id = requireSession(req);
  const athlete = await getAthlete(id);
  if (athlete) {
    try { await stravaDeauthorize(await validToken(athlete)); } catch (e) { console.error(e); }
    await db(`athletes?id=eq.${id}`, { method: "DELETE" }); // les activités sont supprimées en cascade
  }
  endSession(res);
  json(res, 200, { ok: true });
});
