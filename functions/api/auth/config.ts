import { json } from "../../_lib/http";

interface Env {
  GOOGLE_CLIENT_ID: string;
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  return json({ googleClientId: env.GOOGLE_CLIENT_ID || "" }, 200, {
    "Cache-Control": "no-store"
  });
};
