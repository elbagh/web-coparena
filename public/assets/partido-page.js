/*
 * /torneo/partido/?p=ID — cómo fue un partido, punto a punto.
 *
 * Dos peticiones, una sola vez cada una y sin sondeo: un partido terminado no
 * cambia, y la página existe justamente para lo que ya pasó.
 *   - `/api/historial?partido=ID` trae el log entero replegado: cada línea con el
 *     marcador que dejó, y los cambios intercalados donde ocurrieron.
 *   - `/api/plantilla?partido=ID` trae los nombres, dorsales y metales. Es la
 *     misma que pide el directo, y está cacheada 5 minutos.
 *
 * La barra no vuelve a plegar nada. Cada línea llega con `a`/`b`/`sa`/`sb`
 * calculados en el servidor, así que moverse por el partido es leer una posición
 * de un array. Contar puntos aquí sería una segunda versión de las reglas del
 * juego, que es exactamente lo que `lado_punto` existe para evitar.
 *
 * `CopaPartidoVista`, `CopaCromo` y `CopaArenaMatches` se leen de frente, sin
 * `?.`: la página los carga antes que esto justamente para que estén.
 */
(() => {
  const raiz = document.querySelector("[data-partido-pagina]");
  if (!raiz) return;

  const vista = window.CopaPartidoVista;
  const utils = window.CopaArenaMatches;
  const { el, texto } = vista;

  const $ = (sel) => document.querySelector(sel);

  const cajaEstado = $("[data-partido-estado]");
  const cabecera = $("[data-partido-cabecera]");
  const cajaVersus = $("[data-versus]");
  const cajaRepaso = $("[data-repaso]");
  const barra = $("[data-repaso-barra]");
  const carril = $("[data-repaso-carril]");
  const cajaFeed = $("[data-feed]");
  const cajaSets = $("[data-feed-sets]");
  const cajaResumen = $("[data-resumen]");

  const retratos = vista.pista();

  /** Todo lo que se ha cargado, y la posición de la barra dentro de ello. */
  let historial = null;
  let plantilla = null;
  let lineas = [];
  /** Nodos `<li>` del historial, en el mismo orden que `lineas`. */
  let nodos = [];
  /** 0 = antes del primer punto; n = después de la línea n − 1. */
  let momento = 0;

  const AL_EMPEZAR = { a: 0, b: 0, sa: 0, sb: 0, s: 1 };

  const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --------------------------------------------------------------- cargar ---

  async function cargar() {
    const partidoId = new URLSearchParams(location.search).get("p");
    if (!partidoId) {
      fallo("Elige un partido en el cuadro.");
      return;
    }

    try {
      const [respHistorial, respPlantilla] = await Promise.all([
        fetch(`/api/historial?partido=${encodeURIComponent(partidoId)}`, {
          headers: { Accept: "application/json" }
        }),
        fetch(`/api/plantilla?partido=${encodeURIComponent(partidoId)}`, {
          headers: { Accept: "application/json" }
        })
      ]);

      if (respHistorial.status === 404) {
        fallo("Ese partido no existe.");
        return;
      }
      if (!respHistorial.ok || !respPlantilla.ok) {
        fallo("No se ha podido cargar el partido.");
        return;
      }

      historial = await respHistorial.json();
      plantilla = vista.plantilla(await respPlantilla.json());
      lineas = historial.lineas || [];
      pintar();
    } catch {
      fallo("No se ha podido cargar el partido.");
    }
  }

  function fallo(mensaje) {
    texto(cajaEstado, mensaje);
    cajaEstado.hidden = false;
  }

  // --------------------------------------------------------------- pintar ---

  function pintar() {
    const partido = historial.partido;

    cajaEstado.hidden = true;
    cabecera.hidden = false;
    cajaVersus.hidden = false;

    texto($("[data-partido-fase]"), partido.ronda);
    texto($("[data-partido-titulo]"), `${partido.teams.A.name} contra ${partido.teams.B.name}`);
    texto($("[data-partido-cuando]"), cuandoSeJugo(partido));
    $("[data-partido-vivo]").hidden = partido.status !== "live";

    const pista = partido.pista ? `${partido.pista} · ` : "";
    texto($("[data-versus-ronda]"), `${pista}${partido.ronda}`);

    pintarCronologia();
    pintarResumen();

    if (lineas.length === 0) {
      // Un partido llevado a mano no tiene log: lo honesto es decirlo y enseñar
      // el resultado que sí hay, no una barra que no recorre nada.
      texto(cajaEstado, "Este partido no se anotó punto a punto.");
      cajaEstado.hidden = false;
      cajaRepaso.hidden = true;
      pintarResultadoPlano();
      return;
    }

    cajaRepaso.hidden = false;
    barra.max = String(lineas.length);
    pintarCarril();
    irA(lineas.length);
  }

  /**
   * El marcador tal y como quedó en `partidos`, sin pliegue detrás.
   *
   * Es lo único que se puede enseñar de un partido que se llevó desde el panel:
   * el resultado y sus parciales, si los tecleó alguien. Recorrer con la barra un
   * partido así no es posible, y fingir que sí lo es sería peor que decirlo.
   */
  function pintarResultadoPlano() {
    const partido = historial.partido;
    texto($("[data-versus-sets-a]"), String(partido.sets.A));
    texto($("[data-versus-sets-b]"), String(partido.sets.B));
    texto($("[data-versus-puntos-a]"), String(partido.points.A));
    texto($("[data-versus-puntos-b]"), String(partido.points.B));
    texto($("[data-versus-detalle]"), utils.statusLabel(partido.status));

    const parciales = $("[data-versus-parciales]");
    const historia = partido.history || [];
    parciales.hidden = historia.length === 0;
    texto(parciales, historia.map((set) => `${set.a}–${set.b}`).join(" · "));

    retratos.pintarLado("A", plantilla, historial.enPistaFinal.A);
    retratos.pintarLado("B", plantilla, historial.enPistaFinal.B);
  }

  /** «sáb 1 ago, 18:30», o nada si el partido nunca tuvo hora puesta. */
  function cuandoSeJugo(partido) {
    if (!partido.scheduledAt) return "";
    return utils.formatDateTime(partido.scheduledAt);
  }

  // ----------------------------------------------------------- cronología ---

  /**
   * La cronología entera, ascendente y partida por sets.
   *
   * Al revés que en `/directo/`, donde lo último manda porque es lo que está
   * pasando. Aquí se lee como la crónica de un partido, y de paso el recorrido de
   * la barra de izquierda a derecha se corresponde con el de la lista de arriba
   * abajo.
   */
  function pintarCronologia() {
    cajaSets.replaceChildren();
    nodos = [];
    cajaFeed.hidden = lineas.length === 0;
    if (lineas.length === 0) return;

    let setActual = null;
    let lista = null;

    lineas.forEach((linea, indice) => {
      if (linea.s !== setActual) {
        setActual = linea.s;
        cajaSets.append(cabeceraDeSet(setActual));
        lista = el("ol", "feed-lista");
        cajaSets.append(lista);
      }

      const item = vista.crearLinea(linea);
      item.dataset.indice = String(indice);
      texto(item.querySelector(".feed-cuando"), `${linea.a}–${linea.b}`);
      texto(item.querySelector(".feed-que"), vista.textoDeLinea(linea, plantilla));
      lista.append(item);
      nodos.push(item);
    });
  }

  /**
   * La cabecera de un set, con el parcial con el que acabó.
   *
   * El parcial sale de la última línea del set que sea un EVENTO: un cambio
   * arrastra el marcador de su ancla, así que si el set termina con un cambio
   * detrás del punto final, leer la última línea a secas daría el mismo número
   * por otro camino en el mejor caso y uno viejo en el peor.
   */
  function cabeceraDeSet(numero) {
    const delSet = lineas.filter((linea) => linea.s === numero && !linea.c);
    const ultima = delSet[delSet.length - 1];

    const titulo = el("h3", "feed-set");
    titulo.append(el("span", "feed-set-nombre", `Set ${numero}`));
    if (ultima) titulo.append(el("span", "feed-set-parcial", `${ultima.a}–${ultima.b}`));
    return titulo;
  }

  // --------------------------------------------------------------- resumen ---

  /**
   * Lo que hizo cada jugador en este partido.
   *
   * Es del partido ENTERO y no se mueve con la barra. Recalcularlo por momento
   * obligaría a contar puntos en el cliente, y quién se lleva cada rally lo
   * decide `lado_punto` en el servidor: aquí sólo se leen las filas que ya
   * escribió el pliegue.
   */
  function pintarResumen() {
    const totales = (historial.totales || []).filter((fila) =>
      (historial.metricas || []).some((metrica) => (fila[metrica.clave] || 0) > 0)
    );
    cajaResumen.hidden = totales.length === 0;
    if (totales.length === 0) return;

    const tabla = $("[data-resumen-tabla]");
    tabla.replaceChildren();

    const thead = document.createElement("thead");
    const filaCabecera = document.createElement("tr");
    ["Jugador", ...historial.metricas.map((metrica) => metrica.etiqueta)].forEach((titulo) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = titulo;
      filaCabecera.append(th);
    });
    thead.append(filaCabecera);

    const tbody = document.createElement("tbody");
    // Por puntos, que es la lectura que se viene a buscar; a igualdad, por nombre
    // para que dos partidos del mismo equipo no salgan en orden distinto.
    const ordenados = [...totales].sort(
      (a, b) =>
        (b.puntos || 0) - (a.puntos || 0) ||
        plantilla.comoSeLlama(a.jugadorId).localeCompare(plantilla.comoSeLlama(b.jugadorId), "es")
    );

    ordenados.forEach((fila) => {
      const tr = document.createElement("tr");
      const jugador = plantilla.jugadorDe(fila.jugadorId);
      if (jugador) tr.classList.add(`is-lado-${jugador.lado.toLowerCase()}`);

      const celdaNombre = document.createElement("td");
      celdaNombre.textContent = plantilla.comoSeLlama(fila.jugadorId);
      tr.append(celdaNombre);

      historial.metricas.forEach((metrica) => {
        const td = document.createElement("td");
        td.className = "is-num";
        td.textContent = String(fila[metrica.clave] || 0);
        tr.append(td);
      });
      tbody.append(tr);
    });

    tabla.append(thead, tbody);
  }

  // ----------------------------------------------------------------- barra ---

  /**
   * El carril, con un tramo por set y cada tramo tan ancho como puntos costó.
   *
   * Un tercer set largo se ve largo antes de leer nada, que es lo que un carril
   * plano no dice. Los tramos alternan color y llevan su número encima cuando
   * caben: por debajo de ese ancho, el número se lee peor que la propia franja.
   */
  function pintarCarril() {
    carril.replaceChildren();
    if (lineas.length === 0) return;

    const tramos = [];
    lineas.forEach((linea, indice) => {
      const ultimo = tramos[tramos.length - 1];
      if (ultimo && ultimo.set === linea.s) ultimo.hasta = indice + 1;
      else tramos.push({ set: linea.s, desde: indice, hasta: indice + 1 });
    });

    tramos.forEach((tramo, i) => {
      const ancho = ((tramo.hasta - tramo.desde) / lineas.length) * 100;
      const nodo = el("span", `repaso-tramo repaso-tramo--${i % 2 === 0 ? "par" : "impar"}`);
      nodo.style.width = `${ancho}%`;
      nodo.dataset.set = String(tramo.set);
      // Con menos de un 12% del carril el número no cabe sin recortarse, y un
      // «1» a medias dice menos que la franja sola.
      if (ancho >= 12) nodo.textContent = String(tramo.set);
      carril.append(nodo);
    });
  }

  /**
   * Lleva la página al momento `indice`.
   *
   * 0 es antes del primer punto y `lineas.length` es el final. La cifra no se
   * recalcula: sale de la línea anterior, que el servidor ya replegó.
   */
  function irA(indice, conScroll = false) {
    momento = Math.max(0, Math.min(indice, lineas.length));
    const anterior = momento > 0 ? lineas[momento - 1] : AL_EMPEZAR;

    texto($("[data-versus-sets-a]"), String(anterior.sa));
    texto($("[data-versus-sets-b]"), String(anterior.sb));
    texto($("[data-versus-puntos-a]"), String(anterior.a));
    texto($("[data-versus-puntos-b]"), String(anterior.b));

    const objetivo = utils.setTarget(historial.partido, anterior.s);
    texto($("[data-versus-detalle]"), `Set ${anterior.s} · a ${objetivo}`);

    const parciales = $("[data-versus-parciales]");
    const cerrados = parcialesHasta(momento);
    parciales.hidden = cerrados.length === 0;
    texto(parciales, cerrados.join(" · "));

    pintarPista();
    marcarLinea();

    if (barra.value !== String(momento)) barra.value = String(momento);
    barra.setAttribute("aria-valuetext", comoSeLee());
    texto($("[data-repaso-marcador]"), `${anterior.a}–${anterior.b}`);
    texto($("[data-repaso-que]"), momento === 0 ? "Antes del primer punto" : comoSeLee());

    if (conScroll && nodos[momento - 1]) {
      nodos[momento - 1].scrollIntoView({ block: "nearest", behavior: suave ? "smooth" : "auto" });
    }
  }

  /**
   * Los parciales de los sets ya cerrados en este momento del partido.
   *
   * Una línea cerró un set si deja el contador de sets por encima del que había:
   * el punto que cierra trae el parcial completo (21–18) porque el servidor lo
   * saca del `historial` del pliegue y no de los puntos, que ya volvieron a cero.
   *
   * Un `ajuste` mueve el contador sin haber jugado nada, así que pone al día la
   * cuenta y no aporta parcial: de lo que se jugó antes de adoptar el marcador
   * nadie sabe los parciales, y no se van a inventar aquí.
   */
  function parcialesHasta(hasta) {
    const cerrados = [];
    let sets = 0;
    for (let i = 0; i < hasta; i++) {
      const linea = lineas[i];
      // Un cambio arrastra el marcador de su ancla: contarlo sería contar dos
      // veces el punto del que cuelga.
      if (linea.c) continue;
      const suma = linea.sa + linea.sb;
      if (linea.t !== "ajuste" && suma > sets) cerrados.push(`${linea.a}–${linea.b}`);
      sets = suma;
    }
    return cerrados;
  }

  /** Cómo se lee el momento actual, para el lector de pantalla y el pie de la barra. */
  function comoSeLee() {
    if (momento === 0) return "Antes del primer punto";
    const linea = lineas[momento - 1];
    return `${vista.textoDeLinea(linea, plantilla)}, ${linea.a}–${linea.b}`;
  }

  /**
   * Quién estaba en pista en este momento.
   *
   * Se reconstruye desde la alineación FINAL hacia atrás, deshaciendo cada cambio
   * posterior al momento: quien entró por el hueco `pos` vuelve a ser quien salió.
   * Si en ese hueco no está quien el cambio dice que entró, se para y se deja lo
   * que hay — `fijarAlineacion` sobrescribe la alineación entera sin borrar los
   * cambios, así que ese desajuste es alcanzable y degradar es mejor que
   * inventarse una pista.
   */
  function enPistaEn(indice) {
    const pista = {
      A: [...(historial.enPistaFinal.A || [])],
      B: [...(historial.enPistaFinal.B || [])]
    };
    const huecos = historial.huecos || { A: [], B: [] };

    for (let i = lineas.length - 1; i >= indice; i--) {
      const linea = lineas[i];
      if (linea.t !== "cambio") continue;
      const lado = linea.l;
      const donde = (huecos[lado] || []).indexOf(linea.pos);
      if (donde === -1 || pista[lado][donde] !== linea.j) return pista;
      pista[lado][donde] = linea.x;
    }
    return pista;
  }

  function pintarPista() {
    const enPista = enPistaEn(momento);
    retratos.pintarLado("A", plantilla, enPista.A);
    retratos.pintarLado("B", plantilla, enPista.B);
  }

  /** La línea actual marcada, y atenuado lo que todavía no había pasado. */
  function marcarLinea() {
    nodos.forEach((nodo, indice) => {
      nodo.classList.toggle("is-ahora", indice === momento - 1);
      nodo.classList.toggle("is-futuro", indice > momento - 1);
    });
  }

  // ------------------------------------------------------------- controles ---

  barra.addEventListener("input", () => irA(Number(barra.value), true));
  $("[data-repaso-inicio]").addEventListener("click", () => irA(0, true));
  $("[data-repaso-final]").addEventListener("click", () => irA(lineas.length, true));

  cargar();
})();
