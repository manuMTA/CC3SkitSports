// POST /api/sync — récupère les nouvelles activités Strava de l'utilisateur connecté.
import { handler, requireSession, getUser, syncUser, json, httpError } from "./_lib.js";

export default handler(["POST"], async (req, res) => {
  const user = await getUser(requireSession(req));
  if (!user) throw httpError(401, "Compte introuvable : reconnectez-vous.");
  if (!user.strava_id) throw httpError(400, "Aucun compte Strava n'est lié à votre compte.");
  // Anti-rafale : une synchro au plus toutes les 60 secondes (préserve les quotas Strava).
  if (user.last_sync && Date.now() - new Date(user.last_sync).getTime() < 60000) return json(res, 200, { added: 0, skipped: true });
  const added = await syncUser(user, { maxPages: 5 });
  json(res, 200, { added });
});
