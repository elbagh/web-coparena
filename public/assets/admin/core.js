/*
 * Base compartida por todas las páginas de /admin/*. Se carga desde
 * AdminLayout, antes que el script de cada sección, y expone window.CopaAdmin.
 *
 * Reúne lo que antes estaba copiado en admin.js, admin-ediciones.js y
 * admin-matches.js: el envoltorio de fetch, el arranque contra el evento
 * copa:auth, la banda de error, los helpers de DOM y el constructor de tablas.
 *
 * Sigue el patrón del resto del sitio: IIFE en public/assets/, sin bundler ni
 * imports, cargado con <script is:inline ... defer>.
 */
(() => {
  const loading = document.querySelector("[data-admin-loading]");
  const errorBanner = document.querySelector("[data-admin-error]");
  const content = document.querySelector("[data-admin-content]");

  const cargadores = [];
  let resumenCache = null;

  // ---------------------------------------------------------------- red ---

  /**
   * Envoltorio único de fetch del panel. Devuelve el cuerpo ya parseado y, si
   * la respuesta no es correcta, lanza un Error con `.campos` (errores por
   * campo del servidor) y `.status`, que es lo que esperan los formularios.
   */
  async function api(url, options = {}) {
    const respuesta = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...options,
      headers: { Accept: "application/json", ...(options.headers || {}) }
    });

    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) {
      const err = new Error(datos.error || "No se ha podido completar la acción.");
      err.campos = datos.campos || null;
      err.status = respuesta.status;
      throw err;
    }
    return datos;
  }

  const apiJson = (url, method, cuerpo) =>
    api(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo)
    });

  /** GET /api/admin cacheado: varias secciones lo necesitan en la misma carga. */
  function resumen({ recargar = false } = {}) {
    if (recargar || !resumenCache) resumenCache = api("/api/admin");
    return resumenCache;
  }

  // --------------------------------------------------------------- DOM ---

  const text = (valor) => (valor === null || valor === undefined || valor === "" ? "—" : String(valor));

  const limpiar = (valor) => String(valor || "").trim().replace(/\s+/g, " ");

  function clear(nodo) {
    if (nodo) nodo.textContent = "";
  }

  function el(tag, className, valor) {
    const nodo = document.createElement(tag);
    if (className) nodo.className = className;
    if (valor !== undefined) nodo.textContent = text(valor);
    return nodo;
  }

  function boton(etiqueta, onClick, clase = "admin-btn admin-btn--sm") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = clase;
    b.textContent = etiqueta;
    b.addEventListener("click", onClick);
    return b;
  }

  function enlace(etiqueta, href, clase = "") {
    const a = document.createElement("a");
    a.href = href;
    a.textContent = etiqueta;
    if (clase) a.className = clase;
    return a;
  }

  function etiqueta(texto, tipo = "") {
    return el("span", `admin-tag${tipo ? ` admin-tag--${tipo}` : ""}`, texto);
  }

  // ------------------------------------------------------------- estado ---

  function setError(mensaje) {
    if (!errorBanner) return;
    errorBanner.textContent = mensaje || "";
    errorBanner.hidden = !mensaje;
  }

  function setLoading(activo) {
    if (loading) loading.hidden = !activo;
    if (activo) {
      if (content) content.hidden = true;
      setError("");
    }
  }

  function mostrarContenido() {
    if (content) content.hidden = false;
  }

  // -------------------------------------------------------------- tabla ---

  /**
   * Construye una tabla de datos. Cada celda lleva su data-label para que por
   * debajo de 720px la tabla se convierta en fichas apiladas sin tocar el
   * markup (ver src/styles/admin/tables.css).
   *
   * columnas: [{ etiqueta, clase?, render(fila) -> Node|string }]
   */
  function tabla({ columnas, filas, vacio = "No hay nada todavía." }) {
    if (!filas || filas.length === 0) {
      const hueco = el("div", "admin-empty");
      hueco.append(el("strong", "", vacio));
      return hueco;
    }

    const wrap = el("div", "admin-table-wrap");
    const table = el("table", "admin-table");

    const thead = document.createElement("thead");
    const filaCabecera = document.createElement("tr");
    columnas.forEach((col) => {
      const th = document.createElement("th");
      th.scope = "col";
      if (col.clase) th.className = col.clase;
      th.textContent = col.etiqueta;
      filaCabecera.append(th);
    });
    thead.append(filaCabecera);
    table.append(thead);

    const tbody = document.createElement("tbody");
    filas.forEach((fila) => {
      const tr = document.createElement("tr");
      if (fila.id !== undefined) tr.dataset.id = String(fila.id);
      columnas.forEach((col) => {
        const td = document.createElement("td");
        if (col.clase) td.className = col.clase;
        td.dataset.label = col.etiqueta;
        const valor = col.render(fila);
        if (valor instanceof Node) td.append(valor);
        else td.textContent = text(valor);
        tr.append(td);
      });
      tbody.append(tr);
    });
    table.append(tbody);

    wrap.append(table);
    return wrap;
  }

  /** Agrupa varios nodos en una celda (miniatura + texto, acciones…). */
  function celda(clase, ...hijos) {
    const div = el("div", clase);
    hijos.filter(Boolean).forEach((hijo) => div.append(hijo));
    return div;
  }

  // -------------------------------------------------- confirmación ---

  let dialogoConfirmar = null;

  function construirDialogoConfirmar() {
    const dialogo = document.createElement("dialog");
    dialogo.className = "admin-dialog";
    dialogo.innerHTML = `
      <div class="admin-dialog-shell">
        <div class="admin-dialog-head">
          <h2 class="admin-dialog-title" data-confirmar-titulo></h2>
          <button type="button" class="admin-dialog-close" data-confirmar-cerrar aria-label="Cerrar">×</button>
        </div>
        <div class="admin-dialog-body">
          <p class="admin-confirm-text" data-confirmar-texto></p>
          <p class="admin-confirm-warn" data-confirmar-aviso hidden></p>
        </div>
        <div class="admin-dialog-foot">
          <button type="button" class="admin-btn" data-confirmar-no>Cancelar</button>
          <button type="button" class="admin-btn admin-btn--danger" data-confirmar-si>Borrar</button>
        </div>
      </div>`;
    document.body.append(dialogo);
    return dialogo;
  }

  /**
   * Confirmación de acción destructiva. Sustituye a window.confirm(): el
   * navegador la bloquea en algunos contextos y no permite explicar qué se
   * lleva por delante la operación.
   */
  function confirmar({ titulo = "¿Seguro?", texto, aviso = "", accion = "Borrar" }) {
    if (!dialogoConfirmar) dialogoConfirmar = construirDialogoConfirmar();
    const d = dialogoConfirmar;

    d.querySelector("[data-confirmar-titulo]").textContent = titulo;
    d.querySelector("[data-confirmar-texto]").textContent = texto;
    const nodoAviso = d.querySelector("[data-confirmar-aviso]");
    nodoAviso.textContent = aviso;
    nodoAviso.hidden = !aviso;
    const si = d.querySelector("[data-confirmar-si]");
    si.textContent = accion;

    return new Promise((resolve) => {
      const terminar = (valor) => {
        d.removeEventListener("close", alCerrar);
        si.removeEventListener("click", alSi);
        d.querySelector("[data-confirmar-no]").removeEventListener("click", alNo);
        d.querySelector("[data-confirmar-cerrar]").removeEventListener("click", alNo);
        if (d.open) d.close();
        resolve(valor);
      };
      const alSi = () => terminar(true);
      const alNo = () => terminar(false);
      const alCerrar = () => terminar(false);

      si.addEventListener("click", alSi);
      d.querySelector("[data-confirmar-no]").addEventListener("click", alNo);
      d.querySelector("[data-confirmar-cerrar]").addEventListener("click", alNo);
      d.addEventListener("close", alCerrar);
      d.showModal();
    });
  }

  // ------------------------------------------------- barra lateral ---

  /** Pinta la edición activa y los contadores. Nunca tumba la página. */
  async function pintarBarraLateral() {
    const caja = document.querySelector("[data-admin-context]");
    try {
      const datos = await resumen();

      if (caja && datos.edicion) {
        caja.querySelector("[data-admin-context-anio]").textContent = datos.edicion.anio ?? "—";
        caja.querySelector("[data-admin-context-nombre]").textContent = datos.edicion.nombre || "";
        caja.querySelector("[data-admin-context-cifras]").textContent =
          `${datos.stats?.equipos ?? 0} equipos · ${datos.stats?.jugadores ?? 0} jugadores`;
        caja.hidden = false;
      }

      const contadores = {
        equipos: datos.stats?.equipos,
        jugadores: datos.stats?.jugadores,
        camisetas: datos.stats?.reservasCamisetas
      };
      Object.entries(contadores).forEach(([clave, valor]) => {
        const nodo = document.querySelector(`[data-admin-count="${clave}"]`);
        if (nodo && valor !== undefined) nodo.textContent = String(valor);
      });
    } catch {
      if (caja) caja.hidden = true;
    }
  }

  // ------------------------------------------------------- arranque ---

  /**
   * Registra el cargador de una sección. Se ejecuta cuando la sesión está
   * resuelta y hay usuario; si no lo hay, auth.js ya enseña la puerta de
   * login y aquí no se pinta nada.
   */
  function onReady(fn) {
    cargadores.push(fn);
  }

  let enCurso = null;

  function ejecutarCargadores({ recargarResumen = false } = {}) {
    // Serializa las cargas: el evento copa:auth y el arranque manual pueden
    // coincidir, y dos pintados simultáneos duplicarían filas en pantalla.
    enCurso = (enCurso ?? Promise.resolve()).then(() => cargar(recargarResumen));
    return enCurso;
  }

  async function cargar(recargarResumen) {
    setLoading(true);
    if (recargarResumen) resumenCache = null;
    try {
      await Promise.all(cargadores.map((fn) => fn()));
      mostrarContenido();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido cargar el panel.");
      if (content) content.hidden = true;
    } finally {
      setLoading(false);
    }
    await pintarBarraLateral();
  }

  /** Vuelve a cargar la sección después de una escritura. */
  const recargar = () => ejecutarCargadores({ recargarResumen: true });

  window.addEventListener("copa:auth", (evento) => {
    const detalle = evento.detail || {};
    if (detalle.loading) {
      setLoading(true);
      return;
    }
    if (!detalle.user) {
      setLoading(false);
      if (content) content.hidden = true;
      setError("");
      return;
    }
    ejecutarCargadores({ recargarResumen: true });
  });

  window.CopaAdmin = {
    api,
    apiJson,
    resumen,
    onReady,
    recargar,
    setError,
    setLoading,
    mostrarContenido,
    el,
    clear,
    text,
    limpiar,
    boton,
    enlace,
    etiqueta,
    tabla,
    celda,
    confirmar
  };

  // Si la sesión ya estaba resuelta antes de que se cargara este script, el
  // evento copa:auth no volverá a dispararse: hay que arrancar a mano. Se
  // espera a DOMContentLoaded porque los scripts de sección son `defer` y aún
  // no se han registrado con onReady() cuando core.js termina de ejecutarse.
  function arranqueManual() {
    const estado = window.CopaAuth?.state;
    if (estado && !estado.loading && estado.user) ejecutarCargadores();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", arranqueManual, { once: true });
  } else {
    arranqueManual();
  }
})();
