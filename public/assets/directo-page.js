/*
 * /directo/ — el partido que se está jugando, como un versus.
 *
 * Dos fuentes, con papeles opuestos, igual que en el resto del sitio:
 *   - `/api/directo` es lo que se sondea: marcador, quién está en pista y la
 *     cola del historial. Minúsculo y sin un solo nombre.
 *   - `/api/plantilla` trae los nombres, dorsales y metales. Se pide **una vez
 *     por partido** y se cachea; es lo que permite que el sondeo no los repita.
 *
 * Nada se reconstruye entero. Los retratos se crean una vez y se mueven entre la
 * pista y el banquillo —así la foto no se vuelve a cargar—, y el historial se
 * reconcilia por clave: lo nuevo se añade, lo corregido se parchea y lo deshecho
 * se quita. Por eso el servidor manda la ventana completa y no un incremento: un
 * incremento no sabe decir «ese punto ya no existe».
 *
 * `CopaDirecto` y `CopaCromo` se leen de frente, sin `?.`: la página los carga
 * antes que esto justamente para que estén, y si algún día dejan de estarlo hay
 * que enterarse.
 */
(() => {
  const raiz = document.querySelector("[data-directo-pagina]");
  if (!raiz) return;

  const directo = window.CopaDirecto;
  const cromo = window.CopaCromo;
  const utils = window.CopaArenaMatches;

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, clase, texto) => {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };
  /** Escribe solo si cambia: por punto se repintan tres o cuatro textos. */
  const texto = (nodo, valor) => {
    if (nodo && nodo.textContent !== valor) nodo.textContent = valor;
  };

  const cajaEstado = $("[data-directo-estado]");
  const cajaVersus = $("[data-versus]");
  const cajaFeed = $("[data-feed]");
  const listaFeed = $("[data-feed-lista]");
  const plegable = $("[data-feed-plegable]");

  /** La plantilla del partido que se está pintando. Se pide una sola vez. */
  let plantilla = null;
  let partidoDePlantilla = null;
  let pidiendoPlantilla = null;
  /**
   * Cuándo se puede volver a intentar la plantilla de un partido que falló.
   *
   * El guardia de «ya la tengo» solo se pone al recibirla bien, así que un 500 o
   * un corte de red dejaban a la página pidiéndola **en cada sondeo**: el gasto
   * de cada espectador se dobla justo el día que algo va mal, que es el peor
   * momento posible. Va atado al id del partido para que al empezar otro se
   * pida el suyo sin esperar.
   */
  const ESPERA_TRAS_FALLO_MS = 30000;
  let plantillaFallida = null;
  /** Retratos vivos, por jugador: se mueven, no se recrean. */
  const retratos = new Map();
  /** Líneas del historial, por clave: `e:orden` o `c:id`. */
  const lineas = new Map();
  let ultimoEstado = null;
  let partidoPintado = null;
  let terminado = false;
  let feedAbiertoUnaVez = false;

  // --------------------------------------------------------------- datos ---

  async function asegurarPlantilla(partidoId) {
    if (partidoDePlantilla === partidoId) return plantilla;
    if (pidiendoPlantilla) return pidiendoPlantilla;
    if (plantillaFallida?.partidoId === partidoId && Date.now() < plantillaFallida.hasta) return plantilla;

    const fallo = () => {
      plantillaFallida = { partidoId, hasta: Date.now() + ESPERA_TRAS_FALLO_MS };
      return null;
    };

    pidiendoPlantilla = fetch(`/api/plantilla?partido=${encodeURIComponent(partidoId)}`)
      .then((respuesta) => (respuesta.ok ? respuesta.json() : null))
      .then((datos) => {
        if (!datos) return fallo();
        plantilla = datos;
        partidoDePlantilla = partidoId;
        plantillaFallida = null;
        return datos;
      })
      .catch(fallo)
      .finally(() => {
        pidiendoPlantilla = null;
      });

    return pidiendoPlantilla;
  }

  const jugadorDe = (id) => {
    if (!plantilla) return null;
    for (const lado of ["A", "B"]) {
      const encontrado = plantilla.equipos[lado].jugadores.find((jugador) => jugador.id === id);
      if (encontrado) return { ...encontrado, lado };
    }
    return null;
  };

  /** Cómo se llama alguien en el historial, respetando a quien está oculto. */
  function comoSeLlama(id) {
    const jugador = jugadorDe(id);
    if (!jugador) return "alguien";
    if (jugador.oculto) {
      if (jugador.dorsal !== null && jugador.dorsal !== undefined) return `el ${jugador.dorsal}`;
      return plantilla.equipos[jugador.lado].nombre;
    }
    return jugador.nombre;
  }

  const etiquetaDe = (tipo) => {
    const encontrado = (plantilla?.tipos || []).find((t) => t.clave === tipo);
    return encontrado ? encontrado.etiqueta : tipo;
  };

  // ------------------------------------------------------------- retratos ---

  function retratoDe(jugador, tamano) {
    const guardado = retratos.get(jugador.id);
    if (guardado && guardado.dataset.tamano === tamano) return guardado;

    const nodo = cromo.retrato({
      nivel: jugador.nivel,
      dorsal: jugador.dorsal,
      media: jugador.media,
      nombre: jugador.nombre,
      apellidos: jugador.apellidos,
      fotoUrl: jugador.tieneFoto ? `/api/jugadores?foto=${jugador.id}` : null,
      tamano,
      // Los titulares se ven de entrada; el banquillo vive en un desplegable
      // que en móvil arranca cerrado, así que sus fotos esperan.
      prioridad: tamano === "grande" ? "alta" : "baja",
      etiqueta: jugador.oculto && jugador.dorsal ? `Dorsal ${jugador.dorsal}` : undefined
    });
    nodo.dataset.tamano = tamano;
    nodo.dataset.jugador = String(jugador.id);
    retratos.set(jugador.id, nodo);
    return nodo;
  }

  /**
   * Pone en cada caja exactamente los retratos que tocan, moviendo los nodos que
   * ya existen. Un cambio de jugador es entonces mover un `<span>` de sitio: la
   * foto no se vuelve a pedir y la transición sale gratis.
   */
  function colocar(caja, jugadores, tamano) {
    const quieren = jugadores.map((jugador) => retratoDe(jugador, tamano));
    const hay = [...caja.children];
    if (hay.length === quieren.length && hay.every((nodo, i) => nodo === quieren[i])) return;
    caja.replaceChildren(...quieren);
  }

  function pintarLado(lado, estado) {
    const equipo = plantilla.equipos[lado];
    const enPista = new Set((estado.enPista && estado.enPista[lado]) || []);

    texto($(`[data-versus-nombre-${lado.toLowerCase()}]`), equipo.nombre);

    /*
     * Quién es titular lo dice la alineación del partido, no `esSuplente` de la
     * inscripción: en cuanto entra un suplente, ese suplente está jugando.
     */
    const titulares = equipo.jugadores.filter((jugador) => enPista.has(jugador.id));
    const banquillo = equipo.jugadores.filter((jugador) => !enPista.has(jugador.id));

    colocar($(`[data-versus-pista-${lado.toLowerCase()}]`), titulares, "grande");
    colocar($(`[data-versus-suplentes-${lado.toLowerCase()}]`), banquillo, "pequeno");

    const caja = $(`[data-versus-banquillo-${lado.toLowerCase()}]`);
    caja.hidden = banquillo.length === 0;
    texto(
      $(`[data-versus-banquillo-${lado.toLowerCase()}-titulo]`),
      banquillo.length === 1 ? "Banquillo (1)" : `Banquillo (${banquillo.length})`
    );
  }

  // ------------------------------------------------------------ historial ---

  const claveDe = (linea) => (linea.c ? `c:${linea.c}` : `e:${linea.o}`);

  /**
   * El marcador que dejó cada punto del set en curso.
   *
   * Se anda hacia atrás desde el marcador actual, que es exacto: cada punto
   * anterior tenía uno menos en el lado que lo ganó. Los sets ya cerrados se
   * quedan sin cifra —su parcial está arriba— porque para eso habría que traer
   * el log entero en cada sondeo.
   */
  function marcadoresDelSet(feed, partido) {
    const marcadores = new Map();
    let a = partido.points.A;
    let b = partido.points.B;

    for (let i = feed.length - 1; i >= 0; i--) {
      const linea = feed[i];
      if (linea.s !== partido.setNumber || !linea.p) continue;
      marcadores.set(claveDe(linea), `${a}–${b}`);
      if (linea.p === "A") a -= 1;
      else b -= 1;
    }
    return marcadores;
  }

  function textoDeLinea(linea) {
    if (linea.t === "cambio") return `Entra ${comoSeLlama(linea.j)} por ${comoSeLlama(linea.x)}`;
    if (linea.t === "ajuste") return "Marcador adoptado";
    return `${etiquetaDe(linea.t)} de ${comoSeLlama(linea.j)}`;
  }

  function crearLinea(linea) {
    const item = el("li", `feed-linea feed-linea--${linea.t}`);
    if (linea.l) item.classList.add(`feed-linea--lado-${linea.l.toLowerCase()}`);
    item.append(el("span", "feed-cuando"), el("span", "feed-que"));
    return item;
  }

  function pintarFeed(estado, partido) {
    const feed = estado.feed || [];
    cajaFeed.hidden = feed.length === 0;
    if (feed.length === 0) return;

    const marcadores = marcadoresDelSet(feed, partido);
    const vistas = new Set();

    // Del más reciente al más antiguo: lo que acaba de pasar, arriba.
    const orden = [...feed].reverse();
    let anterior = null;
    for (const linea of orden) {
      const clave = claveDe(linea);
      vistas.add(clave);

      let item = lineas.get(clave);
      if (!item) {
        item = crearLinea(linea);
        lineas.set(clave, item);
      }
      texto(item.querySelector(".feed-cuando"), marcadores.get(clave) || `Set ${linea.s}`);
      texto(item.querySelector(".feed-que"), textoDeLinea(linea));

      // El orden solo se toca si de verdad cambió: mover nodos cuesta.
      const deberiaIrTras = anterior;
      if (deberiaIrTras ? item.previousElementSibling !== deberiaIrTras : item !== listaFeed.firstElementChild) {
        if (deberiaIrTras) deberiaIrTras.after(item);
        else listaFeed.prepend(item);
      }
      anterior = item;
    }

    // Lo que ya no está en la ventana y sí estaba: un punto deshecho.
    for (const [clave, item] of lineas) {
      if (vistas.has(clave)) continue;
      const orden = Number(clave.slice(2));
      const esViejo = !clave.startsWith("e:") || orden < (feed[0] ? feed[0].o : 0);
      if (esViejo) continue;
      item.remove();
      lineas.delete(clave);
    }

    const restantes = (estado.feedTotal || 0) - feed.filter((linea) => !linea.c).length;
    const mas = $("[data-feed-mas]");
    mas.hidden = restantes <= 0;
    texto(mas, restantes === 1 ? "Y un punto más antes de esto." : `Y ${restantes} puntos más antes de esto.`);
  }

  // ------------------------------------------------------------ vibración ---

  /** El retrato de quien acaba de hacer el punto se sacude. La animación es de
   * `cromo.js`, que es de donde es el retrato: el anotador hace lo mismo. */
  function celebrar(jugadorId) {
    cromo.vibrar(retratos.get(jugadorId));
  }

  /** Lo que ha entrado en el historial desde el sondeo anterior. */
  function novedades(feed, previo) {
    if (!previo) return [];
    const antes = new Set(previo.map(claveDe));
    return feed.filter((linea) => !antes.has(claveDe(linea)));
  }

  // --------------------------------------------------------------- pintar ---

  async function pintar(estado, info) {
    const partido = (estado && estado.partidos && estado.partidos[0]) || null;

    if (!partido) {
      // Un partido que acaba de terminar no se borra de la pantalla en el
      // momento más visto del día: se queda con su resultado y un rótulo.
      if (partidoPintado && info && info.cerroAlguno) {
        terminado = true;
        texto(cajaEstado, "Final");
        cajaEstado.hidden = false;
        return;
      }
      cajaVersus.hidden = true;
      cajaFeed.hidden = true;
      cajaEstado.hidden = false;
      texto(
        cajaEstado,
        estado && estado.siguiente
          ? `Ahora mismo no se está jugando nada. El siguiente es ${estado.siguiente.equipos[0]} contra ${estado.siguiente.equipos[1]}.`
          : "Ahora mismo no se está jugando nada."
      );
      return;
    }

    terminado = false;
    if (!(await asegurarPlantilla(partido.id))) {
      texto(cajaEstado, "No se ha podido cargar quién juega.");
      cajaEstado.hidden = false;
      return;
    }

    // Otro partido: los retratos y el historial del anterior ya no valen.
    if (partidoPintado !== partido.id) {
      retratos.clear();
      lineas.clear();
      listaFeed.replaceChildren();
      partidoPintado = partido.id;
    }

    cajaEstado.hidden = true;
    cajaVersus.hidden = false;

    const pista = plantilla.partido.pista ? `${plantilla.partido.pista} · ` : "";
    texto($("[data-versus-ronda]"), `${pista}${partido.ronda}`);
    texto($("[data-versus-puntos-a]"), String(partido.points.A));
    texto($("[data-versus-puntos-b]"), String(partido.points.B));

    const objetivo = utils.setTarget(partido, partido.setNumber);
    texto(
      $("[data-versus-detalle]"),
      `Set ${partido.setNumber} · Sets ${partido.sets.A}–${partido.sets.B} · a ${objetivo}`
    );
    const parciales = $("[data-versus-parciales]");
    parciales.hidden = !partido.history || partido.history.length === 0;
    texto(parciales, (partido.history || []).map((set) => `${set.a}–${set.b}`).join(" · "));

    pintarLado("A", estado);
    pintarLado("B", estado);

    const nuevas = novedades(estado.feed || [], ultimoEstado && ultimoEstado.feed);
    pintarFeed(estado, partido);

    // La celebración va después de pintar: el retrato ya está donde toca.
    for (const linea of nuevas) {
      if (linea.t !== "cambio" && linea.t !== "ajuste" && linea.j) celebrar(linea.j);
    }

    // En pantalla grande el historial cabe abierto; en móvil manda el marcador.
    if (!feedAbiertoUnaVez && window.matchMedia("(min-width: 901px)").matches) {
      plegable.open = true;
      feedAbiertoUnaVez = true;
    }

    ultimoEstado = estado;
  }

  /*
   * La cadencia rápida solo mientras el versus está de verdad en pantalla. Quien
   * se ha ido al historial no necesita el marcador al segundo, y cada sondeo suyo
   * es uno menos para quien sí mira.
   */
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(
      (entradas) => directo.mirandoDeCerca(entradas.some((e) => e.isIntersecting)),
      { rootMargin: "80px" }
    ).observe(cajaVersus);
  } else {
    directo.mirandoDeCerca(true);
  }

  directo.suscribir(pintar);
})();
