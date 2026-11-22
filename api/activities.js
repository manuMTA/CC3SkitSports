// /api/activities — séances saisies à la main ou importées depuis un fichier (sans Strava).
//   POST { activity: {...} }   ajouter une séance
//   POST { import: [ ... ] }   importer plusieurs séances (fichier CSV analysé dans le navigateur)
//   DELETE ?id=<uuid>          supprimer une de ses séances (hors séances synchronisées depuis Strava)
import { handler, json, readBody, query, requireSession, db, httpError, isUuid, upsertByStravaId } from "./_lib.js";

function clean(a, userId, source) {
  const ts = new Date(a.start_date_local);
  if (isNaN(ts)) throw httpError(400, "Date invalide.");
  const iso = ts.toISOString();
  const num = (v, max) => { const n = Number(v); return isFinite(n) && n >= 0 ? Math.min(n, max) : 0; };
  return {
    user_id: userId,
    source,
    start_date: iso,
    start_date_local: iso,
    sport_type: String(a.sport_type || "Autre").slice(0, 40),
    name: String(a.name || "").slice(0, 200),
    distance: num(a.distance, 2_000_000),     // mètres
    moving_time: Math.round(num(a.moving_time, 7 * 86400)),
    elapsed_time: Math.round(num(a.moving_time, 7 * 86400)),
    elevation: num(a.elevation, 20000),
    avg_hr: num(a.avg_hr, 250) || null,
  };
}

export default handler(["POST", "DELETE"], async (req, res) => {
  const userId = requireSession(req);

  if (req.method === "DELETE") {
    const id = query(req).id;
    if (!isUuid(id)) throw httpError(400, "Identifiant invalide.");
    await db(`activities?id=eq.${id}&user_id=eq.${userId}&source=neq.strava`, { method: "DELETE" });
    return json(res, 200, { ok: true });
  }

  const b = await readBody(req);
  if (b.activity) {
    const row = clean(b.activity, userId, "manual");
    if (!row.moving_time) throw httpError(400, "Indiquez la durée de la séance.");
    await db("activities", { method: "POST", body: row, prefer: "return=minimal" });
    return json(res, 200, { ok: true });
  }

  if (Array.isArray(b.import)) {
    if (b.import.length > 5000) throw httpError(400, "Fichier trop volumineux (5 000 séances maximum par import).");
    const rows = b.import.map(a => {
      const r = clean(a, userId, "import");
      const sid = Number(a.strava_id);
      return sid > 0 && Number.isSafeInteger(sid) ? { ...r, strava_id: sid } : r;
    });
    // Séances issues d'un export Strava : identifiant Strava connu, donc pas de doublon si on réimporte.
    const withId = rows.filter(r => r.strava_id);
    const without = rows.filter(r => !r.strava_id);
    if (withId.length) await upsertByStravaId(withId);
    // Autres fichiers : on ignore les séances déjà présentes (même date, même sport).
    if (without.length) {
      const existing = await db(`activities?user_id=eq.${userId}&select=start_date,sport_type&limit=20000`);
      const seen = new Set(existing.map(e => new Date(e.start_date).toISOString().slice(0, 16) + e.sport_type));
      const fresh = without.filter(r => !seen.has(r.start_date.slice(0, 16) + r.sport_type));
      for (let i = 0; i < fresh.length; i += 500) await db("activities", { method: "POST", body: fresh.slice(i, i + 500), prefer: "return=minimal" });
    }
    return json(res, 200, { imported: rows.length });
  }

  throw httpError(400, "Requête invalide.");
});
