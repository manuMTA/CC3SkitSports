// POST /api/sync — récupère les nouvelles activités Strava de l'utilisateur connecté.
import { handler, requireSession, getAthlete, syncAthlete, json, httpError } from "./_lib.js";

export default handler(["POST"], async (req, res) => {
  const id = requireSession(req);
  const athlete = await getAthlete(id);
  if (!athlete) throw httpError(401, "Compte introuvable : reconnectez-vous avec Strava.");
  // Anti-rafale : une synchro au plus toutes les 60 secondes (préserve les quotas Strava).
  if (athlete.last_sync && Date.now() - new Date(athlete.last_sync).getTime() < 60000) {
    return json(res, 200, { added: 0, skipped: true });
  }
  const added = await syncAthlete(athlete, { maxPages: 5 });
  json(res, 200, { added });
});
