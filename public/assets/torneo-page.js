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
  const avisoDirecto = raiz.querySelector("[data-torneo-directo]");
  const avisoEnlace = raiz.querySelector("[data-torneo-directo-enlace]");

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
    // Sale de los datos, así que aparece sola el año que alguien no puede
    // competir y desaparece sola el año que no pasa.
    if (fase.grupos.some((grupo) => grupo.clasificacion.some((fila) => fila.clasifica === "retirado"))) {
      entradas.push(["retirado", "No compite"]);
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
    aspirante: "Se juega la plaza de repesca.",
    retirado: "No compite: no ocupa plaza."
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
        /*
         * La cruz de quien no compite, delante del nombre. Va como nodo y no
         * como ::after para que se pueda probar, y `aria-hidden` porque la
         * primera celda ya lo dice con palabras: sin eso se anunciaría dos
         * veces.
         */
        if (indice === 1 && fila.clasifica === "retirado") {
          const cruz = el("span", "torneo-tabla-cruz", "✕");
          cruz.setAttribute("aria-hidden", "true");
          td.prepend(cruz);
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

    /*
     * El historial solo se ofrece cuando existe: `conHistorial` sale de que el
     * partido tenga log de anotación, no de que esté terminado. Un partido
     * llevado a mano desde el panel no tiene nada que recorrer, y un enlace a una
     * página que va a decir «no se anotó punto a punto» es peor que ningún
     * enlace. En pasado, porque el partido lo está.
     */
    if (partido.status === "finished" && partido.conHistorial) {
      const enlace = el("a", "torneo-partido-historial", "Cómo fue");
      enlace.href = enlaceAlHistorial(partido);
      caja.append(enlace);
    }
    return caja;
  }

  const enlaceAlHistorial = (partido) => `/torneo/partido/?p=${encodeURIComponent(partido.id)}`;

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

  /*
   * Una casilla del cuadro lleva a donde ese partido tenga algo que enseñar: al
   * directo si se está jugando, y a su historial si ya se jugó y se anotó punto a
   * punto. Sin ninguna de las dos cosas no navega — mandar a alguien a un
   * marcador que no es el suyo es peor que no llevarle a ninguna parte.
   */
  const irAlPartido = (partido) => {
    if (partido?.status === "live") location.href = "/directo/";
    else if (partido?.status === "finished" && partido.conHistorial) {
      location.href = enlaceAlHistorial(partido);
    }
  };

  // --------------------------------------------------------------- directo ---

  /*
   * El marcador ya no vive aquí: /directo/ es su propia página. Lo que se queda
   * es la suscripción, porque `cerroAlguno` es lo ÚNICO que puede cambiar una
   * clasificación y por tanto lo único que justifica volver a pedir el endpoint
   * pesado. Y se queda sin `mirandoDeCerca`: a esta página le basta con
   * enterarse en un minuto de que un partido ha terminado.
   */
  function alDirecto(datos, info) {
    if (avisoDirecto) {
      const jugando = datos?.partidos?.[0] || null;
      avisoDirecto.hidden = !jugando;
      if (jugando) {
        avisoEnlace.textContent = `${jugando.teams.A.name} ${jugando.points.A}–${jugando.points.B} ${jugando.teams.B.name}`;
      }
    }
    if (info?.cerroAlguno) cargar();
  }

  reintentar?.addEventListener("click", cargar);

  directo.suscribir(alDirecto);
  cargar();
})();
