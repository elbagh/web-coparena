/*
 * Lo que comparten las dos pantallas que pintan un partido: `/directo/` mientras
 * se juega y `/torneo/partido/` cuando ya se jugó.
 *
 * Las dos dibujan el mismo versus sobre el mismo marcado (`src/components/
 * Versus.astro`) y escriben las mismas frases en el historial —«Ace de Berta»,
 * «Entra Nuria por Marta»—, con el mismo cuidado con quien pidió no salir del
 * álbum: sale por su dorsal, sin nombre y sin foto. Repetirlo en dos ficheros
 * habría sido dejar que un día dijeran cosas distintas de la misma persona.
 *
 * Lo que NO vive aquí es lo que de verdad separa a las dos: el directo sondea,
 * reconcilia por clave y celebra; el historial se pide una vez y se recorre con
 * una barra. Eso se queda en cada página.
 *
 * `CopaCromo` se lee de frente, sin `?.`: las dos páginas lo cargan antes que
 * esto justamente para que esté.
 */
(() => {
  const cromo = window.CopaCromo;

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

  const $ = (sel) => document.querySelector(sel);

  // ------------------------------------------------------------ plantilla ---

  /**
   * Los dos equipos con su gente, tal y como los sirve `/api/plantilla`, con las
   * consultas que hacen falta para escribir el historial.
   */
  function plantilla(datos) {
    const jugadorDe = (id) => {
      for (const lado of ["A", "B"]) {
        const encontrado = datos.equipos[lado].jugadores.find((jugador) => jugador.id === id);
        if (encontrado) return { ...encontrado, lado };
      }
      return null;
    };

    /*
     * Cómo se llama alguien en el historial.
     *
     * Quien está oculto sale por su dorsal y nunca por sus iniciales: dentro de
     * un equipo de cuatro identifican tanto como el nombre. Sin dorsal, por su
     * equipo — el marcador tiene que cuadrar aunque no se pueda decir quién fue.
     */
    const comoSeLlama = (id) => {
      const jugador = jugadorDe(id);
      if (!jugador) return "alguien";
      if (jugador.oculto) {
        if (jugador.dorsal !== null && jugador.dorsal !== undefined) return `el ${jugador.dorsal}`;
        return datos.equipos[jugador.lado].nombre;
      }
      return jugador.nombre;
    };

    const etiquetaDe = (tipo) => {
      const encontrado = (datos.tipos || []).find((t) => t.clave === tipo);
      return encontrado ? encontrado.etiqueta : tipo;
    };

    return { datos, jugadorDe, comoSeLlama, etiquetaDe };
  }

  // ------------------------------------------------------------- retratos ---

  /**
   * La caché de retratos de una pantalla.
   *
   * Los retratos se crean una vez y se MUEVEN entre la pista y el banquillo: un
   * cambio de jugador es entonces mover un `<span>` de sitio, la foto no se
   * vuelve a pedir y la transición sale gratis. Recrearlos revalidaría dieciséis
   * imágenes por repintado.
   */
  function pista() {
    const retratos = new Map();

    const retratoDe = (jugador, tamano) => {
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
    };

    /** Pone en la caja exactamente los retratos que tocan, moviendo los que ya hay. */
    const colocar = (caja, jugadores, tamano) => {
      if (!caja) return;
      const quieren = jugadores.map((jugador) => retratoDe(jugador, tamano));
      const hay = [...caja.children];
      if (hay.length === quieren.length && hay.every((nodo, i) => nodo === quieren[i])) return;
      caja.replaceChildren(...quieren);
    };

    /**
     * Un lado entero: nombre del equipo, titulares en grande y banquillo dentro
     * de su desplegable.
     *
     * Quién es titular lo dice `enPista`, no `esSuplente` de la inscripción: en
     * cuanto entra un suplente, ese suplente está jugando.
     */
    const pintarLado = (lado, laPlantilla, idsEnPista) => {
      const equipo = laPlantilla.datos.equipos[lado];
      const dentro = new Set(idsEnPista || []);
      const bajo = lado.toLowerCase();

      texto($(`[data-versus-nombre-${bajo}]`), equipo.nombre);

      const titulares = equipo.jugadores.filter((jugador) => dentro.has(jugador.id));
      const banquillo = equipo.jugadores.filter((jugador) => !dentro.has(jugador.id));

      colocar($(`[data-versus-pista-${bajo}]`), titulares, "grande");
      colocar($(`[data-versus-suplentes-${bajo}]`), banquillo, "pequeno");

      const caja = $(`[data-versus-banquillo-${bajo}]`);
      if (caja) caja.hidden = banquillo.length === 0;
      texto(
        $(`[data-versus-banquillo-${bajo}-titulo]`),
        banquillo.length === 1 ? "Banquillo (1)" : `Banquillo (${banquillo.length})`
      );
    };

    return {
      retratoDe,
      colocar,
      pintarLado,
      retrato: (id) => retratos.get(id),
      vaciar: () => retratos.clear()
    };
  }

  // ------------------------------------------------------------ historial ---

  /** La clave con la que se reconoce una línea: un evento por su orden, un cambio por su id. */
  const claveDe = (linea) => (linea.c ? `c:${linea.c}` : `e:${linea.o}`);

  /** Lo que dice una línea del historial, en palabras. */
  const textoDeLinea = (linea, laPlantilla) => {
    if (linea.t === "cambio") {
      return `Entra ${laPlantilla.comoSeLlama(linea.j)} por ${laPlantilla.comoSeLlama(linea.x)}`;
    }
    if (linea.t === "ajuste") return "Marcador adoptado";
    return `${laPlantilla.etiquetaDe(linea.t)} de ${laPlantilla.comoSeLlama(linea.j)}`;
  };

  /** El `<li>` vacío de una línea, con su color de lado y sus dos huecos. */
  const crearLinea = (linea) => {
    const item = el("li", `feed-linea feed-linea--${linea.t}`);
    if (linea.l) item.classList.add(`feed-linea--lado-${linea.l.toLowerCase()}`);
    item.append(el("span", "feed-cuando"), el("span", "feed-que"));
    return item;
  };

  window.CopaPartidoVista = { plantilla, pista, claveDe, textoDeLinea, crearLinea, el, texto };
})();
