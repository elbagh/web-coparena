/*
 * Acceso a las herramientas de la organización desde Mi zona.
 *
 * Quien tiene permisos no tenía ningún camino a /admin/ ni a /anotador/ desde el
 * sitio público: se llegaba escribiendo la URL, y el anotador es la herramienta
 * del día del torneo.
 *
 * El bocadillo NO viaja en el HTML: no hay marcado en mi-equipo.astro y se
 * construye aquí solo cuando /api/me confirma el permiso. Quien entra sin rol no
 * ve nada, ni en pantalla ni en el código fuente de la página. Eso es cortesía y
 * discreción, no una puerta: la de verdad la ponen `requirePermiso` en cada
 * endpoint y el gate de AdminLayout / AnotadorLayout.
 */
(() => {
  const pagina = document.querySelector(".perfil-page");
  const hero = pagina?.querySelector(".legal-hero");
  if (!hero) return;

  /*
   * Copia a mano del par que exige el endpoint: functions/api/anotacion.ts pasa
   * por `requireAlgunPermiso(["partidos.anotar", "partidos.editar"])`. El rol
   * Organización lleva `partidos.editar`, así que puede anotar de verdad y el
   * enlace no le promete una pantalla que responda 403. Si allí se cierra, aquí
   * sobra: lo vigila test/unit/mi-zona-herramientas.test.ts.
   */
  const PERMISOS_ANOTAR = ["partidos.anotar", "partidos.editar"];

  const puede = (permiso) => Boolean(window.CopaAuth?.puede?.(permiso));

  function el(etiqueta, clase, texto) {
    const nodo = document.createElement(etiqueta);
    if (clase) nodo.className = clase;
    if (texto != null) nodo.textContent = texto;
    return nodo;
  }

  // El nodo insertado y la combinación con la que se pintó. Comparar la clave
  // evita rehacerlo en cada `copa:auth`, que se dispara también al recargar la
  // sesión sin que hayan cambiado los permisos.
  let nodo = null;
  let clave = "";

  function enlace(href, texto) {
    const a = el("a", "paso-link", texto);
    a.href = href;
    return a;
  }

  function construir(panel, anotar, rol) {
    // Sin la clase `.paso`: en «Pasos para apuntarse» el color, la inclinación
    // y el lado del rabito los reparte `:nth-child()`, y este bocadillo lo
    // inserta un script, así que su posición entre los hermanos decidiría cómo
    // se pinta. El ancho y el color los pone `.zona-herramientas`.
    const seccion = el("section", "zona-herramientas");
    seccion.setAttribute("aria-labelledby", "zona-herramientas-titulo");

    const burbuja = el("div", "paso-bubble");

    /*
     * En «Pasos para apuntarse» este sello lleva el número del paso, que ahí es
     * información: los pasos son una secuencia. Aquí no hay secuencia, así que
     * en su sitio va el nombre del rol, que sí dice algo — con qué sombrero
     * puestas entras y por qué aparecen estos botones.
     */
    if (rol) burbuja.appendChild(el("span", "zona-herramientas-rol", rol));

    const titulo = el("h2", null, "Herramientas del torneo");
    titulo.id = "zona-herramientas-titulo";
    burbuja.appendChild(titulo);
    // La línea dice lo único que el título y los botones no dicen: que este
    // atajo no está en la página de todo el mundo.
    burbuja.appendChild(el("p", null, "Solo lo ve quien tiene permisos."));

    const enlaces = el("div", "zona-herramientas-links");
    if (panel) enlaces.appendChild(enlace("/admin/", "Panel"));
    if (anotar) enlaces.appendChild(enlace("/anotador/", "Anotar en directo"));
    burbuja.appendChild(enlaces);

    seccion.appendChild(burbuja);
    return seccion;
  }

  function pintar() {
    const panel = puede("panel.entrar");
    const anotar = PERMISOS_ANOTAR.some(puede);
    // El nombre del rol solo decora el sello: si falta, el bocadillo sale igual.
    const rol = window.CopaAuth?.state?.acceso?.rolNombre || "";
    const nueva = panel || anotar ? `${panel}|${anotar}|${rol}` : "";

    if (nueva === clave) return;
    clave = nueva;

    if (nodo) {
      nodo.remove();
      nodo = null;
    }
    // Sin permisos no hay nodo: cerrar sesión o entrar en «ver como» (donde
    // `acceso` es el del usuario suplantado) lo retira sin recargar.
    if (!nueva) return;

    nodo = construir(panel, anotar, rol);
    hero.insertAdjacentElement("afterend", nodo);
  }

  window.addEventListener("copa:auth", (evento) => {
    if (evento.detail?.loading) return;
    pintar();
  });

  // Si la sesión ya estaba resuelta cuando se cargó este script, el evento no
  // volverá a dispararse: hay que pintar a mano, igual que hace perfil.js.
  const estado = window.CopaAuth?.state;
  if (estado && !estado.loading) pintar();
})();
