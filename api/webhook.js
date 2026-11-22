// /api/webhook — événements Strava (exigés par l'accord API pour gérer les révocations d'accès).
// GET  : validation de l'abonnement (hub.challenge).
// POST : création / modification / suppression d'activité, révocation de l'accès par l'athlète.
import { handler, query, readBody, json, env, getAthlete, validToken, stravaGet, activityRow, upsertActivities, db } from "./_lib.js";

export default handler(["GET", "POST"], async (req, res) => {
  if (req.method === "GET") {
    const q = query(req);
    if (q["hub.mode"] === "subscribe" && q["hub.verify_token"] === env("STRAVA_WEBHOOK_VERIFY_TOKEN")) {
      return json(res, 200, { "hub.challenge": q["hub.challenge"] });
    }
    return json(res, 403, { error: "Jeton de vérification invalide" });
  }

  const ev = await readBody(req);
  try {
    if (ev.object_type === "athlete" && ev.updates && String(ev.updates.authorized) === "false") {
      await db(`athletes?id=eq.${Number(ev.owner_id)}`, { method: "DELETE" });
    } else if (ev.object_type === "activity") {
      if (ev.aspect_type === "delete") {
        await db(`activities?id=eq.${Number(ev.object_id)}`, { method: "DELETE" });
      } else {
        const athlete = await getAthlete(ev.owner_id);
        if (athlete) {
          const a = await stravaGet(await validToken(athlete), `/activities/${Number(ev.object_id)}`);
          if (a) await upsertActivities([activityRow(a, athlete.id)]);
        }
      }
    }
  } catch (e) {
    console.error("webhook", e); // Strava attend toujours un 200 rapide
  }
  json(res, 200, { ok: true });
});
