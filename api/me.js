// GET /api/me — profil et activités de l'utilisateur connecté (et uniquement les siennes).
import { handler, sessionAthleteId, db, json, isAdmin, PUBLIC_ATHLETE_FIELDS } from "./_lib.js";

export default handler(["GET"], async (req, res) => {
  const id = sessionAthleteId(req);
  if (!id) return json(res, 200, { connected: false });
  const rows = await db(`athletes?id=eq.${id}&select=${PUBLIC_ATHLETE_FIELDS}`);
  if (!rows[0]) return json(res, 200, { connected: false });
  const activities = await db(
    `activities?athlete_id=eq.${id}&select=id,start_date_local,sport_type,name,distance,moving_time,elevation,avg_hr&order=start_date.desc&limit=5000`
  );
  json(res, 200, { connected: true, athlete: rows[0], isAdmin: isAdmin(id), activities });
});
