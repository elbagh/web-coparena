import { vi } from "vitest";

export type Siguiente = ReturnType<typeof vi.fn<() => Promise<Response>>>;

export interface ContextoDeTest<E> {
  contexto: EventContext<E, string, Record<string, unknown>>;
  /** Espía de `next`: los tests del middleware afirman si la petición pasó. */
  next: Siguiente;
}

/**
 * Fabrica el `EventContext` que Pages inyecta a `onRequestX`, para poder llamar
 * a los handlers de `functions/` directamente sin construir el worker.
 *
 * `next` resuelve un 204 vacío: cualquier respuesta distinta que devuelva un
 * middleware es, por definición, suya.
 */
export function crearContexto<E>(
  request: Request,
  env: E,
  params: Record<string, string> = {}
): ContextoDeTest<E> {
  const next: Siguiente = vi.fn(async () => new Response(null, { status: 204 }));
  const contexto = {
    request,
    env,
    params,
    data: {},
    functionPath: new URL(request.url).pathname,
    waitUntil: () => {},
    passThroughOnException: () => {},
    next
  } as unknown as EventContext<E, string, Record<string, unknown>>;

  return { contexto, next };
}

/** Atajo para los handlers que no comprueban `next`, que son casi todos. */
export const ctx = <E>(request: Request, env: E, params: Record<string, string> = {}) =>
  crearContexto(request, env, params).contexto;
