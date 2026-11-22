// POST /api/account — actions de l'utilisateur connecté sur son compte.
//   { action: "password", current, password }  changer (ou créer) son mot de passe
//   { action: "email", email, password }        ajouter un e-mail à un compte créé via Strava
//   { action: "unlink_strava" }                 délier Strava (efface les activités venues de Strava)
//   { action: "delete" }                        supprimer le compte et toutes ses données
import {
  handler, json, readBody, requireSession, getUser, getUserBy, db, endSession, httpError,
  checkPasswordRules, hashPassword, verifyPassword, normEmail, unlinkStrava, stravaDeauthorize, validToken, publicUser,
} from "./_lib.js";

export default handler(["POST"], async (req, res) => {
  const user = await getUser(requireSession(req));
  if (!user) { endSession(res); throw httpError(401, "Compte introuvable."); }
  const b = await readBody(req);

  if (b.action === "password") {
    if (user.password_hash && !verifyPassword(b.current, user.password_hash)) throw httpError(400, "Mot de passe actuel incorrect.");
    checkPasswordRules(b.password);
    await db(`users?id=eq.${user.id}`, { method: "PATCH", body: { password_hash: hashPassword(b.password) } });
    return json(res, 200, { ok: true });
  }

  if (b.action === "email") {
    if (user.email) throw httpError(400, "Ce compte a déjà une adresse e-mail.");
    const email = normEmail(b.email);
    checkPasswordRules(b.password);
    const other = await getUserBy("email", email);
    if (other) throw httpError(409, "Cette adresse est déjà utilisée par un autre compte.");
    await db(`users?id=eq.${user.id}`, { method: "PATCH", body: { email, password_hash: hashPassword(b.password) } });
    return json(res, 200, { user: publicUser(await getUser(user.id)) });
  }

  if (b.action === "unlink_strava") {
    if (!user.strava_id) return json(res, 200, { ok: true });
    if (!user.email) throw httpError(400, "Ajoutez d'abord un e-mail et un mot de passe, sinon vous ne pourrez plus vous connecter.");
    await unlinkStrava(user);
    return json(res, 200, { ok: true });
  }

  if (b.action === "delete") {
    if (user.strava_id) { try { await stravaDeauthorize(await validToken(user)); } catch (e) { console.error(e); } }
    await db(`users?id=eq.${user.id}`, { method: "DELETE" }); // activités supprimées en cascade
    endSession(res);
    return json(res, 200, { ok: true });
  }

  throw httpError(400, "Action inconnue.");
});
