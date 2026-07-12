interface Env {
  DB: D1Database;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" }
  });

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "El cuerpo debe ser JSON válido" }, 400);
  }

  const team = typeof body.team === "string" ? body.team.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";

  if (!team || team.length > 80) {
    return json({ error: "Falta 'team' (nombre del equipo, máximo 80 caracteres)" }, 400);
  }
  if (!EMAIL_PATTERN.test(email) || email.length > 120) {
    return json({ error: "Falta 'email' válido" }, 400);
  }

  await env.DB
    .prepare("INSERT INTO inscripciones (team_name, contact_email) VALUES (?1, ?2)")
    .bind(team, email)
    .run();

  return json({ ok: true }, 201);
};
