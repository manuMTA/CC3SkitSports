// GET /api/auth/login — redirige vers la page d'autorisation Strava.
import { handler, env, appUrl, randomToken, setCookie, redirect } from "../_lib.js";

export default handler(["GET"], async (req, res) => {
  const state = randomToken();
  setCookie(res, "oauth_state", state, 600);
  const qs = new URLSearchParams({
    client_id: env("STRAVA_CLIENT_ID"),
    redirect_uri: `${appUrl()}/api/auth/callback`,
    response_type: "code",
    approval_prompt: "auto",
    scope: "read,activity:read_all",
    state,
  });
  redirect(res, `https://www.strava.com/oauth/authorize?${qs}`);
});
