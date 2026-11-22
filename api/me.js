// GET /api/me — profil et activités de l'utilisateur connecté (et uniquement les siennes).
import { handler, sessionUserId, getUser, db, json, isAdminUser, publicUser, stravaEnabled, ACTIVITY_FIELDS } from "./_lib.js";

export default handler(["GET"], async (req, res) => {
  const user = await getUser(sessionUserId(req));
  if (!user) return json(res, 200, { connected: false, stravaEnabled: stravaEnabled() });
  const activities = await db(`activities?user_id=eq.${user.id}&select=${ACTIVITY_FIELDS}&order=start_date.desc&limit=5000`);
  json(res, 200, { connected: true, user: publicUser(user), isAdmin: isAdminUser(user), stravaEnabled: stravaEnabled(), activities });
});
