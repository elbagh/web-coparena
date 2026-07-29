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
      seccion.classList.add("is-grupos");
      if (fase.grupos.length === 0) {
        seccion.append(el("p", "torneo-nota", "Los grupos se sortean antes de empezar."));
        return seccion;
      }

      seccion.append(leyendaDeFase(fase));

      /*
       * Un grupo es una columna entera: su clasificación y debajo sus partidos,
       * que son los de una sola tarde. Apilados ocupaban tres pantallas para
       * enseñar lo que cabe en una.
       */
      const rejilla = el("div", "torneo-grupos");
      fase.grupos.forEach((grupo) => rejilla.append(bloqueDeGrupo(fase, grupo)));
      seccion.append(rejilla);
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

  /*
   * Qué significa cada color, dicho una sola vez para toda la fase. Antes la
   * frase de la repesca salía en la nota de cada grupo, y con los grupos en
   * columnas eso son tres copias de lo mismo, una al lado de la otra.
   */
  function leyendaDeFase(fase) {
    const entradas = [["directo", "Pasa al cuadro"]];
    if (fase.repesca > 0 && fase.grupos.some((grupo) => grupo.enRepesca !== false)) {
      entradas.push([
        "repesca",
        fase.repesca === 1 ? "Se juega la última plaza" : `Se juegan las ${fase.repesca} últimas plazas`
      ]);
    }

    const leyenda = el("p", "torneo-leyenda");
    entradas.forEach(([clave, texto]) => {
      const item = el("span", "torneo-leyenda-item");
      item.append(el("span", `torneo-leyenda-muestra is-${clave}`), el("span", "", texto));
      leyenda.append(item);
    });
    return leyenda;
  }

  function bloqueDeGrupo(fase, grupo) {
    const bloque = el("div", "torneo-grupo-publico");
    const partidos = (fase.partidos || [])
      .filter((p) => p.grupoId === grupo.id)
      .sort((a, b) => ordenPorHora(a) - ordenPorHora(b));
    const comun = cuandoComun(partidos);

    bloque.append(cabeceraDeGrupo(grupo, comun));

    if (grupo.equipos.length === 0) {
      bloque.append(el("p", "torneo-nota", "Sin equipos todavía."));
      return bloque;
    }

    bloque.append(tablaClasificacion(grupo, fase));

    if (partidos.length > 0) {
      const lista = el("div", "torneo-partidos");
      partidos.forEach((partido) =>
        lista.append(tarjetaPartido(partido, { prefijo: grupo.nombre, soloHora: comun !== null }))
      );
      bloque.append(lista);
    }

    return bloque;
  }

  // Un partido sin hora todavía puesta va al final, no al principio.
  const ordenPorHora = (partido) => (partido.scheduledAt ? Date.parse(partido.scheduledAt) : Infinity);

  function cabeceraDeGrupo(grupo, comun) {
    const cabecera = el("h3", "torneo-grupo-cabecera");
    cabecera.append(el("span", "torneo-grupo-letra", grupo.nombre));

    if (comun) {
      const cuando = el("span", "torneo-grupo-cuando");
      const dia = utils?.formatDate ? utils.formatDate(comun.scheduledAt) : "";
      if (dia) cuando.append(el("span", "", dia));
      if (comun.pista) cuando.append(el("span", "", comun.pista));
      if (cuando.childElementCount > 0) cabecera.append(cuando);
    }

    return cabecera;
  }

  /*
   * La fecha y la pista suben a la cabecera de la columna solo cuando TODOS los
   * partidos del grupo las comparten, que es lo normal: cada grupo juega su
   * tarde entera del tirón. Repetirlas en cada tarjeta es gastar una línea por
   * partido en decir lo mismo seis veces.
   *
   * Si el grupo se parte en dos tardes o en dos pistas devuelve null y cada
   * tarjeta recupera las suyas. La cabecera no puede afirmar algo que no se
   * cumple: se leería como el horario del grupo entero.
   */
  function cuandoComun(partidos) {
    if (partidos.length === 0 || partidos.some((partido) => !partido.scheduledAt)) return null;

    // Por el día tal y como se ve, no por el texto de la fecha: es el que se
    // enseña, y el que decide si «sáb 1 ago» vale para toda la columna.
    const dias = new Set(partidos.map((partido) => new Date(partido.scheduledAt).toDateString()));
    const pistas = new Set(partidos.map((partido) => partido.pista || ""));
    if (dias.size !== 1 || pistas.size !== 1) return null;

    return { scheduledAt: partidos[0].scheduledAt, pista: partidos[0].pista || "" };
  }

  /** Lo que dice cada color, en palabras. */
  const EXPLICACION = {
    directo: "Pasa al cuadro.",
    repesca: "Ahora mismo ocupa la plaza de repesca.",
    aspirante: "Se juega la plaza de repesca."
  };

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
        // El color no puede ser lo único que lo diga: quien no lo ve se queda
        // con una tabla en la que no pasa nada.
        if (indice === 0 && EXPLICACION[fila.clasifica]) {
          td.append(el("span", "sr-only", ` ${EXPLICACION[fila.clasifica]}`));
        }
        tr.append(td);
      });
      tbody.append(tr);
    });

    tabla.append(thead, tbody);
    caja.append(tabla);

    const nota = notaDeClasificacion(grupo);
    if (nota) caja.append(el("p", "torneo-nota", nota));
    return caja;
  }

  /*
   * La nota se queda en el cupo del grupo, que sí cambia de uno a otro: aquí,
   * dos en A y B pero tres en C. Lo de la repesca lo cuenta la leyenda de la
   * fase, una vez; repetido debajo de cada columna era la misma frase larga
   * tres veces seguidas.
   */
  function notaDeClasificacion(grupo) {
    if (!(grupo.clasifican > 0)) return "";
    return `Pasan ${grupo.clasifican === 1 ? "el primero" : `los ${grupo.clasifican} primeros`}.`;
  }

  function tarjetaPartido(partido, opciones = {}) {
    const compacto = opciones.prefijo !== undefined;
    const caja = el("article", `torneo-partido is-${partido.status}${compacto ? " is-compacto" : ""}`);

    caja.append(compacto ? metaDeColumna(partido, opciones) : metaSuelta(partido));

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

  /** Ronda, fecha y pista: la de un partido suelto, sin columna que lo sitúe. */
  function metaSuelta(partido) {
    const meta = el("div", "torneo-partido-meta");
    meta.append(el("span", "", partido.ronda));
    if (partido.scheduledAt && utils?.formatDateTime) {
      meta.append(el("span", "", utils.formatDateTime(partido.scheduledAt)));
    }
    if (partido.pista) meta.append(el("span", "", partido.pista));
    return meta;
  }

  /*
   * Dentro de la columna de un grupo, la hora es lo único que se viene a buscar:
   * el día y la pista están en la cabecera y el grupo, en la letra. Así que va
   * delante y destacada, y de la ronda se quita el «A · » que ya dice la propia
   * columna.
   */
  function metaDeColumna(partido, opciones) {
    const meta = el("div", "torneo-partido-meta");

    const cuando = horaDe(partido, opciones.soloHora === true);
    if (cuando) meta.append(el("span", "torneo-partido-hora", cuando));

    meta.append(el("span", "", rondaCorta(partido, opciones.prefijo)));
    if (partido.pista && opciones.soloHora !== true) meta.append(el("span", "", partido.pista));
    return meta;
  }

  function horaDe(partido, soloHora) {
    if (!partido.scheduledAt) return "";
    if (soloHora && utils?.formatTime) return utils.formatTime(partido.scheduledAt);
    return utils?.formatDateTime ? utils.formatDateTime(partido.scheduledAt) : "";
  }

  /*
   * El prefijo solo se quita si de verdad está: la ronda la escribe la
   * organización y puede decir cualquier cosa. Recortar a ciegas los primeros
   * caracteres convertiría «Repesca» en cualquier otro texto.
   */
  function rondaCorta(partido, prefijo) {
    const marca = `${prefijo} · `;
    return partido.ronda.startsWith(marca) ? partido.ronda.slice(marca.length) : partido.ronda;
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
