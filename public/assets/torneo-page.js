/*
 * /torneo/ — el cuadro, el calendario y las clasificaciones.
 *
 * Dos fuentes, a propósito:
 *   - /api/torneo trae lo pesado y se pide UNA vez. Está cacheado 30 s y solo se
 *     vuelve a pedir cuando el directo avisa de que un partido ha cerrado, que
 *     es lo único que puede cambiar una clasificación.
 *   - /api/directo es minúsculo y lo sondea CopaDirecto.
 *
 * Sondear el pesado sería agotar la cuota de peticiones de Cloudflare en una
 * tarde, y encima para releer una tabla que casi nunca cambia.
 */
(() => {
  const raiz = document.querySelector("[data-torneo]");
  if (!raiz) return;

  /*
   * Se pide de frente, sin `?.`. BaseLayout carga directo.js antes del slot
   * justo para que esté aquí, y si algún día deja de estarlo hay que enterarse:
   * con encadenamiento opcional, la página se quedaba sin marcador en silencio
   * y todo lo demás parecía correcto.
   */
  const directo = window.CopaDirecto;

  const estado = raiz.querySelector("[data-torneo-status]");
  const reintentar = raiz.querySelector("[data-torneo-retry]");
  const cajaFases = raiz.querySelector("[data-torneo-fases]");
  const cajaSueltos = raiz.querySelector("[data-torneo-sueltos]");
  const listaSueltos = raiz.querySelector("[data-torneo-sueltos-lista]");
  const lede = raiz.querySelector("[data-torneo-lede]");

  const panelDirecto = raiz.querySelector("[data-directo-panel]");
  const panelVacio = raiz.querySelector("[data-directo-panel-vacio]");
  const panelPartidos = raiz.querySelector("[data-directo-panel-partidos]");
  const botonRefrescar = raiz.querySelector("[data-directo-refrescar]");

  const utils = window.CopaArenaMatches;

  const el = (tag, clase, texto) => {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };

  const setEstado = (mensaje, conReintento = false) => {
    if (estado) {
      estado.textContent = mensaje || "";
      estado.hidden = !mensaje;
    }
    if (reintentar) reintentar.hidden = !conReintento;
  };

  // ------------------------------------------------------------- el cuadro ---

  let torneo = null;

  async function cargar() {
    setEstado("Cargando el torneo…");
    try {
      const respuesta = await fetch("/api/torneo", { headers: { Accept: "application/json" } });
      const datos = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw new Error(datos.error || "No se ha podido cargar el torneo.");

      torneo = datos;
      pintar();
      setEstado("");
    } catch (error) {
      setEstado(error.message, true);
    }
  }

  function pintar() {
    const fases = torneo?.fases || [];
    const sueltos = torneo?.sueltos || [];

    if (lede && torneo?.edicion) {
      lede.textContent = `${torneo.edicion.nombre}. Quién juega, contra quién y cómo va.`;
    }

    cajaFases.textContent = "";
    if (fases.length === 0 && sueltos.length === 0) {
      setEstado("El cuadro aparecerá aquí en cuanto la organización sortee los cruces.");
      cajaFases.hidden = true;
      cajaSueltos.hidden = true;
      return;
    }

    fases.forEach((fase) => cajaFases.append(seccionDeFase(fase)));
    cajaFases.hidden = fases.length === 0;

    listaSueltos.textContent = "";
    sueltos.forEach((partido) => listaSueltos.append(tarjetaPartido(partido)));
    cajaSueltos.hidden = sueltos.length === 0;
  }

  function seccionDeFase(fase) {
    const seccion = el("section", "torneo-seccion");
    seccion.append(el("h2", "", fase.nombre));

    if (fase.tipo === "grupos") {
      fase.grupos.forEach((grupo) => seccion.append(bloqueDeGrupo(fase, grupo)));
      if (fase.grupos.length === 0) {
        seccion.append(el("p", "torneo-nota", "Los grupos se sortean antes de empezar."));
      }
      return seccion;
    }

    const cuadro = el("div", "torneo-cuadro");
    const pintado = utils?.renderBracket
      ? utils.renderBracket(cuadro, fase.partidos, (partido) => irAlPartido(partido))
      : false;
    if (pintado) seccion.append(cuadro);
    else seccion.append(el("p", "torneo-nota", "El cuadro se monta cuando terminen los grupos."));

    return seccion;
  }

  function bloqueDeGrupo(fase, grupo) {
    const bloque = el("div", "torneo-grupo-publico");
    bloque.append(el("h3", "", grupo.nombre));

    if (grupo.equipos.length === 0) {
      bloque.append(el("p", "torneo-nota", "Sin equipos todavía."));
      return bloque;
    }

    bloque.append(tablaClasificacion(grupo, fase));

    const partidos = (fase.partidos || [])
      .filter((p) => p.grupoId === grupo.id)
      .sort((a, b) => ordenPorHora(a) - ordenPorHora(b));
    if (partidos.length > 0) {
      const lista = el("div", "torneo-partidos");
      partidos.forEach((partido) => lista.append(tarjetaPartido(partido)));
      bloque.append(lista);
    }

    return bloque;
  }

  // Un partido sin hora todavía puesta va al final, no al principio.
  const ordenPorHora = (partido) => (partido.scheduledAt ? Date.parse(partido.scheduledAt) : Infinity);

  /*
   * En el móvil una tabla de ocho columnas es ilegible, así que solo se enseña
   * lo que decide la posición: jugados, ganados y puntos. El resto (sets,
   * puntos a favor) va detrás de un resumen desplegable, no se tira.
   */
  function tablaClasificacion(grupo, fase) {
    const caja = el("div", "torneo-tabla-scroll");
    const tabla = el("table", "torneo-tabla");

    const thead = document.createElement("thead");
    const filaCabecera = document.createElement("tr");
    ["", "Equipo", "PJ", "G", "Sets", "Pts"].forEach((titulo) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = titulo;
      filaCabecera.append(th);
    });
    thead.append(filaCabecera);

    const tbody = document.createElement("tbody");
    grupo.clasificacion.forEach((fila) => {
      const tr = document.createElement("tr");
      /*
       * Quién pasa de ronda es la lectura principal de la tabla, y pasar
       * directo no es lo mismo que pasar por repesca: esa segunda plaza depende
       * de cómo queden los demás grupos. Dos colores, no uno.
       */
      if (fila.clasifica) tr.classList.add(`is-${fila.clasifica}`);

      const celdas = [
        String(fila.posicion),
        fila.nombre,
        String(fila.jugados),
        String(fila.ganados),
        `${fila.setsAFavor}-${fila.setsEnContra}`,
        String(fila.puntos)
      ];
      celdas.forEach((valor, indice) => {
        const td = document.createElement("td");
        td.textContent = valor;
        if (indice !== 1) td.className = "is-num";
        tr.append(td);
      });
      tbody.append(tr);
    });

    tabla.append(thead, tbody);
    caja.append(tabla);

    const nota = notaDeClasificacion(grupo, fase);
    if (nota) caja.append(el("p", "torneo-nota", nota));
    return caja;
  }

  /*
   * La nota describe la regla real, que ya no es «pasan los N primeros»: cada
   * grupo puede dar un número distinto de plazas y encima puede haber repesca.
   * Con grupos de tamaños distintos, decir lo de siempre sería mentir.
   */
  function notaDeClasificacion(grupo, fase) {
    const directas =
      grupo.clasifican > 0
        ? `Pasan ${grupo.clasifican === 1 ? "el primero" : `los ${grupo.clasifican} primeros`} de este grupo.`
        : "";
    if (!fase.repesca || grupo.enRepesca === false) return directas;
    const extra =
      fase.repesca === 1
        ? "Una plaza más se decide entre los mejores clasificados que quedan justo fuera."
        : `${fase.repesca} plazas más se deciden entre los mejores clasificados que quedan justo fuera.`;
    return `${directas} ${extra}`.trim();
  }

  function tarjetaPartido(partido) {
    const caja = el("article", `torneo-partido is-${partido.status}`);

    const cabecera = el("div", "torneo-partido-meta");
    cabecera.append(el("span", "", partido.ronda));
    if (partido.scheduledAt && utils?.formatDateTime) {
      cabecera.append(el("span", "", utils.formatDateTime(partido.scheduledAt)));
    }
    if (partido.pista) cabecera.append(el("span", "", partido.pista));
    caja.append(cabecera);

    const cruce = el("div", "torneo-partido-cruce");
    cruce.append(
      equipoDelPartido(partido, "A"),
      el("span", "torneo-partido-marcador", marcadorDe(partido)),
      equipoDelPartido(partido, "B")
    );
    caja.append(cruce);

    if (partido.status === "finished" && partido.history?.length > 0) {
      caja.append(el("p", "torneo-partido-sets", partido.history.map((set) => `${set.a}-${set.b}`).join(" · ")));
    }
    return caja;
  }

  function equipoDelPartido(partido, lado) {
    const nombre = partido.teams[lado].name || "Por decidir";
    const clase = partido.winner === lado ? "torneo-partido-equipo is-ganador" : "torneo-partido-equipo";
    return el("span", clase, nombre);
  }

  function marcadorDe(partido) {
    if (partido.status === "scheduled") return "vs.";
    return `${partido.sets.A}–${partido.sets.B}`;
  }

  const irAlPartido = () => {
    document.querySelector("#directo")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  // --------------------------------------------------------------- directo ---

  function pintarDirecto(datos, info) {
    const partidos = datos?.partidos || [];
    panelVacio.hidden = partidos.length > 0;
    panelPartidos.hidden = partidos.length === 0;
    botonRefrescar.hidden = !datos?.modoAhorro;

    if (partidos.length === 0) {
      panelVacio.textContent = datos?.siguiente
        ? `Ahora mismo no se está jugando nada. El siguiente es ${datos.siguiente.equipos[0]} contra ${datos.siguiente.equipos[1]}.`
        : "Ahora mismo no se está jugando nada.";
    } else {
      panelPartidos.textContent = "";
      partidos.forEach((partido) => panelPartidos.append(marcadorEnVivo(partido)));
    }

    /*
     * Un partido que termina es lo único que puede cambiar una clasificación, y
     * por eso es lo único que justifica volver a pedir el endpoint pesado.
     */
    if (info?.cerroAlguno) cargar();
  }

  function marcadorEnVivo(partido) {
    const caja = el("article", "directo-marcador");
    caja.append(el("p", "directo-ronda", partido.ronda));

    const cruce = el("div", "directo-cruce");
    cruce.append(
      el("span", "directo-equipo", partido.teams.A.name),
      el("span", "directo-puntos", String(partido.points.A)),
      el("span", "directo-separador", "–"),
      el("span", "directo-puntos", String(partido.points.B)),
      el("span", "directo-equipo", partido.teams.B.name)
    );
    caja.append(cruce);

    const detalle = [`Set ${partido.setNumber}`, `Sets ${partido.sets.A}–${partido.sets.B}`];
    if (partido.reglas) {
      const objetivo = utils?.setTarget ? utils.setTarget(partido, partido.setNumber) : partido.reglas.puntosPorSet;
      detalle.push(`a ${objetivo}`);
    }
    caja.append(el("p", "directo-detalle", detalle.join(" · ")));

    if (partido.history?.length > 0) {
      caja.append(el("p", "directo-sets", partido.history.map((set) => `${set.a}-${set.b}`).join(" · ")));
    }
    return caja;
  }

  botonRefrescar?.addEventListener("click", () => directo.refrescarAhora());
  reintentar?.addEventListener("click", cargar);

  /*
   * La cadencia rápida solo mientras el panel del directo está de verdad en
   * pantalla. Quien está leyendo la clasificación abajo del todo no necesita el
   * marcador al segundo, y cada sondeo suyo es uno menos para quien sí mira.
   */
  if (panelDirecto && "IntersectionObserver" in window) {
    new IntersectionObserver(
      (entradas) => directo.mirandoDeCerca(entradas.some((e) => e.isIntersecting)),
      { rootMargin: "80px" }
    ).observe(panelDirecto);
  } else {
    directo.mirandoDeCerca(true);
  }

  directo.suscribir(pintarDirecto);
  cargar();
})();
