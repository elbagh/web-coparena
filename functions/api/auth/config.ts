import { json } from "../../_lib/http";
import { getGoogleClientId, type GoogleEnv } from "../../_lib/google";

export const onRequestGet: PagesFunction<GoogleEnv> = async ({ env }) => {
  return json({ googleClientId: getGoogleClientId(env) }, 200, {
    "Cache-Control": "no-store"
  });
};
