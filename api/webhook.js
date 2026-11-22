// /api/webhook — événements Strava (exigés par l'accord API pour gérer les révocations d'accès).
// GET  : validation de l'abonnement (hub.challenge).
// POST : création / modification / suppression d'activité, révocation de l'accès par l'athlète.
import { handler, query, readBody, json, env, getUserBy, validToken, stravaGet, activityRow, upsertByStravaId, db } from "./_lib.js";

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
      // L'athlète a retiré l'accès depuis Strava : on efface ses données Strava (le compte e-mail éventuel reste).
      const u = await getUserBy("strava_id", Number(ev.owner_id));
      if (u) {
        await db(`activities?user_id=eq.${u.id}&source=eq.strava`, { method: "DELETE" });
        if (u.email) await db(`users?id=eq.${u.id}`, { method: "PATCH", body: { strava_id: null, access_token: null, refresh_token: null, expires_at: null, last_sync: null } });
        else await db(`users?id=eq.${u.id}`, { method: "DELETE" });
      }
    } else if (ev.object_type === "activity") {
      if (ev.aspect_type === "delete") {
        await db(`activities?strava_id=eq.${Number(ev.object_id)}`, { method: "DELETE" });
      } else {
        const u = await getUserBy("strava_id", Number(ev.owner_id));
        if (u) {
          const a = await stravaGet(await validToken(u), `/activities/${Number(ev.object_id)}`);
          if (a) await upsertByStravaId([activityRow(a, u.id)]);
        }
      }
    }
  } catch (e) {
    console.error("webhook", e); // Strava attend toujours un 200 rapide
  }
  json(res, 200, { ok: true });
});
