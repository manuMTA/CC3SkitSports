// POST /api/auth/logout — ferme la session (les données restent enregistrées).
import { handler, endSession, json } from "../_lib.js";

export default handler(["POST"], async (req, res) => {
  endSession(res);
  json(res, 200, { ok: true });
});
