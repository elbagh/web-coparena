/*
 * Lo mínimo compartido por las dos pantallas del anotador.
 *
 * No se apoya en CopaAdmin: aquel `core.js` trae tablas, diálogos y la barra
 * lateral del panel, y aquí no hace falta nada de eso. Lo que sí hace falta y
 * allí no existe es avisar de que no hay red, porque este panel se usa en una
 * playa.
 */
window.CopaAnotador = (() => {
  const raizError = () => document.querySelector("[data-anot-error]");

  /**
   * Si la última petición se cayó.
   *
   * `navigator.onLine` dice que sí estando enganchado a un wifi sin salida —el
   * chiringuito de la playa, exactamente—, así que por sí solo no vale para
   * encender el aviso. La señal fiable de que no hay red es una petición que se
   * cae, y la de que ha vuelto es una que llega.
   */
  let peticionCaida = false;

  function pintarRed() {
    const caido = navigator.onLine === false || peticionCaida;
    const banda = document.querySelector("[data-anot-offline]");
    if (banda) banda.hidden = !caido;
    document.documentElement.classList.toggle("anot-sin-red", caido);
  }

  function setError(mensaje) {
    const nodo = raizError();
    if (!nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
  }

  /** Llama a la API y propaga el mensaje del servidor tal cual viene. */
  async function api(ruta, method = "GET", cuerpo) {
    let respuesta;
    try {
      respuesta = await fetch(ruta, {
        method,
        cache: "no-store",
        credentials: "include",
        headers: { Accept: "application/json", ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
        body: cuerpo ? JSON.stringify(cuerpo) : undefined
      });
    } catch {
      /*
       * Que `fetch` se caiga es lo único que significa «no hay red». Sin este
       * catch salía el mensaje del navegador tal cual —«Failed to fetch»— en la
       * banda de avisos: en inglés, y sin decir lo único que importa saber, que
       * ese punto no se ha guardado.
       */
      peticionCaida = true;
      pintarRed();
      const error = new Error("Sin conexión: esto no se ha guardado. Repítelo cuando vuelva la cobertura.");
      error.status = 0;
      error.campos = {};
      throw error;
    }

    peticionCaida = false;
    pintarRed();

    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      const error = new Error(datos.error || `No se ha podido guardar (${respuesta.status}).`);
      error.status = respuesta.status;
      error.campos = datos.campos || {};
      throw error;
    }
    return datos;
  }

  /*
   * Sin conexión se desactiva todo y se dice. No hay cola local a propósito:
   * reproducirla luego chocaría contra el UNIQUE(partido_id, orden) y saldría
   * una cascada de conflictos. Un anotador que cree que está guardando y no lo
   * está es peor que uno que sabe que no puede anotar.
   */
  function vigilarConexion() {
    // Los eventos del navegador siguen valiendo para el caso claro (modo avión);
    // el que de verdad pasa en la playa lo detecta `api` al caerse.
    window.addEventListener("online", () => {
      peticionCaida = false;
      pintarRed();
    });
    window.addEventListener("offline", pintarRed);
    pintarRed();
  }

  /** Suplantar es solo lectura: el middleware rechaza cualquier escritura. */
  function vigilarVerComo() {
    const banda = document.querySelector("[data-anot-verComo]");
    const pintar = () => {
      const activo = Boolean(window.CopaAuth?.state?.verComo?.activo);
      if (banda) banda.hidden = !activo;
      document.documentElement.classList.toggle("anot-solo-lectura", activo);
    };
    window.addEventListener("copa:auth", pintar);
    pintar();
  }

  /** Arranca cuando la sesión está resuelta y hay usuario. */
  function alEntrar(fn) {
    const intentar = () => {
      const estado = window.CopaAuth?.state;
      if (estado && !estado.loading && estado.user) fn();
    };
    window.addEventListener("copa:auth", intentar);
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", intentar, { once: true });
    } else {
      intentar();
    }
  }

  vigilarConexion();
  vigilarVerComo();

  return { api, setError, alEntrar };
})();
