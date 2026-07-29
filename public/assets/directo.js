/*
 * El marcador en directo, compartido por el botón de la cabecera y por /torneo/.
 *
 * Sondea /api/directo, que es el único endpoint que pide todo el mundo a la vez
 * y por tanto el único que puede agotar la cuota de peticiones de Cloudflare
 * justo el día que más gente mira. De ahí las reglas de este fichero:
 *
 *   - El intervalo lo manda el SERVIDOR (`siguienteSondeoMs`). El cliente nunca
 *     pide más deprisa que eso, así que subirlo desde el panel frena a todos los
 *     espectadores al siguiente sondeo, sin desplegar nada.
 *   - Con la pestaña oculta no se sondea. Nada.
 *   - Fuera de /torneo/ se sondea despacio: al botón de la cabecera le basta con
 *     enterarse en un minuto de que ha empezado un partido.
 *   - Tras un error se hace backoff, para no rematar un servidor que ya va mal.
 *
 * El ETag no ahorra peticiones (un 304 cuenta igual que un 200): ahorra ancho de
 * banda y lecturas de base. Lo único que ahorra peticiones es sondear menos.
 */
window.CopaDirecto = (() => {
  const MINIMO_MS = 1000;
  const LENTO_POR_DEFECTO_MS = 60000;
  const BACKOFF_MS = [5000, 10000, 20000, 60000];

  const oyentes = new Set();
  let estado = null;
  let etag = null;
  let temporizador = null;
  let fallos = 0;
  let enPrimerPlano = true;
  /** Lo pone /torneo/ cuando el panel del directo está en pantalla. */
  let enPantalla = false;
  let arrancado = false;

  const visible = () => document.visibilityState !== "hidden";

  /** Cuánto esperar hasta el siguiente sondeo. */
  function siguienteEspera() {
    if (fallos > 0) return BACKOFF_MS[Math.min(fallos - 1, BACKOFF_MS.length - 1)];
    if (!estado) return MINIMO_MS * 2;
    if (estado.modoAhorro) return 0; // 0 = no repetir; se refresca a mano.

    const delServidor = Number(estado.siguienteSondeoMs) || LENTO_POR_DEFECTO_MS;
    if (!estado.hayDirecto) return Math.max(delServidor, LENTO_POR_DEFECTO_MS);
    // Con partido en juego, la cadencia rápida solo si se está mirando de verdad.
    return enPantalla ? Math.max(delServidor, MINIMO_MS) : Math.max(delServidor * 5, MINIMO_MS);
  }

  function programar() {
    clearTimeout(temporizador);
    if (!visible() || !enPrimerPlano) return;
    const espera = siguienteEspera();
    if (espera <= 0) return;
    temporizador = setTimeout(refrescar, espera);
  }

  async function refrescar() {
    if (!visible()) return;

    try {
      const cabeceras = { Accept: "application/json" };
      if (etag) cabeceras["If-None-Match"] = etag;
      const respuesta = await fetch("/api/directo", { headers: cabeceras });

      if (respuesta.status === 304) {
        fallos = 0;
      } else if (respuesta.ok) {
        fallos = 0;
        etag = respuesta.headers.get("ETag");
        const anterior = estado;
        estado = await respuesta.json();
        avisar(anterior);
      } else {
        fallos += 1;
      }
    } catch {
      fallos += 1;
    } finally {
      programar();
    }
  }

  /**
   * Avisa a quien escuche. `cerroAlguno` distingue el caso que de verdad
   * importa: un partido que termina obliga a recargar el cuadro y las
   * clasificaciones, y eso vive en otro endpoint mucho más caro.
   */
  function avisar(anterior) {
    const antes = new Set((anterior?.partidos || []).map((p) => p.id));
    const ahora = new Set((estado?.partidos || []).map((p) => p.id));
    const cerroAlguno = [...antes].some((id) => !ahora.has(id));

    oyentes.forEach((oyente) => {
      try {
        oyente(estado, { cerroAlguno, primeraVez: anterior === null });
      } catch (error) {
        console.error("Error pintando el directo:", error);
      }
    });
  }

  function suscribir(oyente) {
    oyentes.add(oyente);
    if (estado) oyente(estado, { cerroAlguno: false, primeraVez: true });
    arrancar();
    return () => oyentes.delete(oyente);
  }

  function arrancar() {
    if (arrancado) return;
    arrancado = true;
    refrescar();
  }

  /** /torneo/ lo enciende cuando su panel entra en pantalla. */
  function mirandoDeCerca(valor) {
    if (enPantalla === valor) return;
    enPantalla = valor;
    programar();
  }

  /** Para el modo ahorro, donde no hay refresco automático. */
  function refrescarAhora() {
    fallos = 0;
    return refrescar();
  }

  document.addEventListener("visibilitychange", () => {
    if (visible()) refrescar();
    else clearTimeout(temporizador);
  });

  window.addEventListener("pagehide", () => clearTimeout(temporizador));

  // -------------------------------------------------------------- cabecera ---

  /*
   * El botón encendido enseña el marcador, no la palabra «directo»: es lo que
   * uno quiere saber. Apagado y encendido son dos elementos distintos porque un
   * <a> deshabilitado no existe en HTML y seguiría siendo enfocable.
   */
  function pintarBoton(datos) {
    const apagado = document.querySelector("[data-directo-apagado]");
    const vivo = document.querySelector("[data-directo-vivo]");
    if (!apagado || !vivo) return;

    const partido = datos?.partidos?.[0] || null;
    apagado.hidden = Boolean(partido);
    vivo.hidden = !partido;

    if (!partido) {
      apagado.querySelector("span:last-child").textContent = datos?.siguiente ? "Aún no ha empezado" : "Sin partido";
      return;
    }

    const texto = vivo.querySelector("[data-directo-texto]");
    const marcador = `${partido.points.A}–${partido.points.B}`;
    // Antes del primer punto el marcador no dice nada: mejor decir qué es.
    texto.textContent = partido.points.A === 0 && partido.points.B === 0 ? "En directo" : marcador;
    vivo.setAttribute(
      "aria-label",
      `En directo: ${partido.teams.A.name} ${partido.points.A}, ${partido.teams.B.name} ${partido.points.B}. Ver el partido.`
    );
  }

  /*
   * Solo se sondea si hay algo que pintar. Este fichero se carga en todas las
   * páginas porque el botón vive en la cabecera, pero el panel no tiene
   * cabecera: allí no hay botón, nadie se suscribe y no se pide nada.
   */
  if (document.querySelector("[data-directo-apagado]")) suscribir(pintarBoton);

  return { suscribir, refrescarAhora, mirandoDeCerca, get estado() { return estado; } };
})();
