/*
 * /anotador/partido/?id=… — el marcador, punto a punto.
 *
 * Flujo de dos toques: jugador → acción. El primero se da sobre la pista, donde
 * la persona está; el segundo siempre en el mismo sitio, abajo, en la zona del
 * pulgar. Que el segundo botón no cambie de posición es lo que permite anotar
 * sin buscar, que es de lo que va todo esto.
 *
 * La pintada es optimista: entre el toque y la respuesta del servidor hay 300 o
 * 600 ms por 4G desde la playa, y un marcador que tarda medio segundo en moverse
 * hace dudar y provoca toques dobles. Se predice con `applyPoint` de
 * match-utils.js —el mismo que ya usa el panel, con las reglas del propio
 * partido— y en cuanto llega la respuesta manda el servidor.
 *
 * `window.CopaArenaMatches` se pide de frente, sin `?.`: la página lo carga
 * antes que este fichero justamente para que esté. Con encadenamiento opcional
 * pasó lo que tenía que pasar — durante un tiempo no se cargaba, el script no
 * fallaba, y lo único que ocurría era que no había predicción y que el objetivo
 * del set decisivo salía mal. Nadie se enteró.
 */
(() => {
  const panel = document.querySelector("[data-anot-panel]");
  if (!panel || !window.CopaAnotador) return;

  const { api, setError, alEntrar } = window.CopaAnotador;
  const utils = window.CopaArenaMatches;
  const cromo = window.CopaCromo;

  const partidoId = new URLSearchParams(location.search).get("id") || "";
  const estadoTexto = document.querySelector("[data-anot-estado]");

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, clase, texto) => {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };

  const otroLado = (lado) => (lado === "A" ? "B" : "A");
  const texto = (nodo, valor) => {
    if (nodo && nodo.textContent !== valor) nodo.textContent = valor;
  };

  let datos = null;
  let elegido = null;
  let guardando = false;
  /** El evento que se está corrigiendo en el diálogo. */
  let correccion = null;
  /** El suplente al que se ha tocado, esperando por quién entra. */
  let entrante = null;
  /** Retratos vivos por jugador: se mueven entre pista y banquillo, no se recrean. */
  const retratos = new Map();

  /** Rehacer un partido cerrado ya no es anotar: pide `partidos.editar`. */
  const puedeEditar = () => Boolean(window.CopaAuth?.state?.acceso?.permisos?.includes("partidos.editar"));

  // ------------------------------------------------------------- pintado ---

  function pintar() {
    if (!datos) return;
    const { estado, alineacion } = datos;
    const terminado = estado.terminado;
    const decidir = Boolean(datos.pendienteDeAdoptar);

    /*
     * Los números grandes son los puntos del set, salvo en dos casos:
     *   - terminado: son los SETS, porque los puntos volvieron a cero al cerrarse
     *     el último y ya no cuentan nada.
     *   - pendiente de decidir: son los del panel, que es por donde va el partido
     *     de verdad. Pintar el 0–0 del log al lado de un aviso que dice «va 12–9»
     *     es contar dos cosas distintas en la misma pantalla.
     */
    const grandes = terminado ? estado.sets : decidir ? datos.marcadorPanel.puntos : estado.puntos;
    const rotulo = $("[data-anot-rotulo]");
    rotulo.hidden = !terminado && !decidir;
    rotulo.textContent = terminado ? "Sets" : "Lo lleva el panel";
    $("[data-anot-puntos-a]").textContent = String(grandes.A);
    $("[data-anot-puntos-b]").textContent = String(grandes.B);

    const sets = decidir ? datos.marcadorPanel.sets : estado.sets;
    $("[data-anot-detalle]").textContent = terminado
      ? `Terminado · ganó ${nombreEquipo(estado.winner)}`
      : decidir
        ? `Sets ${sets.A}–${sets.B} · sin anotar`
        : `Set ${estado.setNumero} · sets ${sets.A}–${sets.B} · a ${objetivo()}`;

    const parciales = $("[data-anot-parciales]");
    parciales.hidden = estado.historial.length === 0;
    parciales.textContent = estado.historial.map((set) => `${set.a}–${set.b}`).join(" · ");

    // Mientras haya marcador de a mano por decidir, la pista y el pulgar no se
    // pintan: sus botones responderían 409.
    pintarDecision(decidir);
    $("[data-anot-pista]").hidden = decidir;
    $("[data-anot-pulgar]").hidden = decidir;

    pintarPista(alineacion, terminado);
    pintarReposo(terminado);
    pintarExtras();
  }

  const nombreEquipo = (lado) => datos.equipos[lado]?.nombre || (lado === "A" ? "Equipo A" : "Equipo B");

  const nombreDeJugador = (id) => {
    for (const lado of ["A", "B"]) {
      const encontrado = (datos.equipos[lado]?.jugadores || []).find((jugador) => jugador.id === id);
      if (encontrado) return encontrado.nombre;
    }
    return "alguien";
  };

  const objetivo = () =>
    utils.setTarget({ reglas: datos.partido.reglas, setNumber: datos.estado.setNumero }, datos.estado.setNumero);

  function pintarDecision(decidir) {
    const caja = $("[data-anot-decision]");
    caja.hidden = !decidir;
    if (!decidir) return;

    const mano = datos.marcadorPanel;
    const marcador = `${mano.puntos.A}–${mano.puntos.B}`;
    const sets = mano.sets.A + mano.sets.B > 0 ? `, sets ${mano.sets.A}–${mano.sets.B}` : "";
    $("[data-anot-decision-titulo]").textContent = `Este partido va ${marcador}${sets} a mano`;
    $("[data-anot-adoptar]").textContent = `Seguir desde ${marcador}`;
  }

  /** El retrato de alguien, creado una vez y reutilizado siempre. */
  function retratoDe(jugador, tamano) {
    const guardado = retratos.get(jugador.id);
    if (guardado && guardado.dataset.tamano === tamano) return guardado;

    const nodo = cromo.retrato({
      nivel: jugador.nivel,
      dorsal: jugador.dorsal,
      media: jugador.media,
      nombre: jugador.nombre,
      apellidos: jugador.apellidos,
      // La ruta pública: el anotador puede no tener permiso de panel, y aquí no
      // hace falta más que la misma cara que ve todo el mundo.
      fotoUrl: jugador.tieneFoto ? `/api/jugadores?foto=${jugador.id}` : null,
      tamano,
      prioridad: tamano === "grande" ? "alta" : "baja"
    });
    nodo.dataset.tamano = tamano;
    nodo.dataset.jugador = String(jugador.id);
    retratos.set(jugador.id, nodo);
    return nodo;
  }

  /**
   * La pista, como un versus: cada equipo en su lado, quien juega en grande y el
   * banquillo debajo en pequeño.
   *
   * Quién es titular lo dice la **alineación del partido**, no `esSuplente` de la
   * inscripción: en cuanto entra un suplente, ese suplente está jugando.
   */
  function pintarPista(alineacion, terminado) {
    for (const lado of ["A", "B"]) {
      const minuscula = lado.toLowerCase();
      const enPista = new Set(alineacion.filter((fila) => fila.lado === lado).map((fila) => fila.jugador_id));
      const plantilla = (datos.equipos[lado]?.jugadores || []).map((jugador) => ({ ...jugador, lado }));

      texto($(`[data-anot-banda-${minuscula}]`), nombreEquipo(lado));

      const caja = $(`[data-anot-mitad-${minuscula}]`);
      caja.textContent = "";
      const jugando = plantilla.filter((jugador) => enPista.has(jugador.id));

      if (jugando.length === 0) {
        caja.append(el("p", "anot-sin-alineacion", "Nadie en pista. Márcalo en «Más»."));
      } else {
        jugando.forEach((jugador) => {
          const boton = el("button", `anot-jugador anot-jugador--${minuscula}`);
          boton.type = "button";
          boton.disabled = terminado;
          boton.append(retratoDe(jugador, "grande"));
          boton.addEventListener("click", () => elegir(jugador));
          caja.append(boton);
        });
      }

      /*
       * El banquillo. Tocar a un suplente no anota: pregunta por quién entra, y
       * esa pregunta sale en la zona del pulgar como todo lo demás.
       */
      const banca = $(`[data-anot-banquillo-${minuscula}]`);
      banca.textContent = "";
      plantilla
        .filter((jugador) => !enPista.has(jugador.id))
        .forEach((jugador) => {
          const boton = el("button", `anot-suplente anot-suplente--${minuscula}`);
          boton.type = "button";
          boton.disabled = terminado || jugando.length === 0;
          boton.append(retratoDe(jugador, "pequeno"));
          boton.addEventListener("click", () => elegirSuplente(jugador));
          banca.append(boton);
        });
    }
  }

  function pintarReposo(terminado) {
    const ultimo = datos.eventos[datos.eventos.length - 1] || null;
    const texto = $("[data-anot-ultimo]");
    const deshacer = $("[data-anot-deshacer]");

    if (ultimoFueCambio()) {
      const cambio = datos.cambios[datos.cambios.length - 1];
      texto.textContent = `Entra ${nombreDeJugador(cambio.entra)} por ${nombreDeJugador(cambio.sale)}`;
      deshacer.disabled = guardando || (terminado && !puedeEditar());
      return;
    }

    if (!ultimo) {
      texto.textContent = "Sin puntos todavía.";
      deshacer.disabled = true;
      return;
    }

    texto.textContent = resumen(ultimo);
    /*
     * Ofrecer deshacer a quien va a recibir un error es ofrecerle un fallo: un
     * partido terminado sólo lo toca quien puede editar, y el saldo de apertura
     * no se deshace nunca —el servidor lo rechaza, porque borrarlo dejaba el
     * marcador adoptado en 0–0 sin forma de recuperarlo—.
     */
    deshacer.disabled = guardando || ultimo.tipo === "ajuste" || (terminado && !puedeEditar());
  }

  /**
   * Lo último anotado, en una línea.
   *
   * Cuando ese punto cerró un set lo dice, con su parcial. Antes ponía «Punto
   * de ataque de X · 0–0» —el tipo que hoy es «punto» se llamaba entonces
   * «remate»; nada que ver con el atributo del cromo, que es lo único que ese
   * nombre designa en el resto del sitio— porque el marcador ya se había
   * reiniciado, y leído del tirón parecía que esa acción hubiera dejado el
   * partido a cero.
   */
  function resumen(evento) {
    const etiqueta = (datos.tipos.find((t) => t.clave === evento.tipo) || {}).etiqueta || evento.tipo;
    if (!evento.jugador) return `Marcador adoptado · ${datos.estado.puntos.A}–${datos.estado.puntos.B}`;

    if (evento.setNumero !== datos.estado.setNumero) {
      const parcial = datos.estado.historial[datos.estado.historial.length - 1];
      const cierre = parcial ? ` (${parcial.a}–${parcial.b})` : "";
      return `${etiqueta} de ${evento.jugador} · cerró el set ${evento.setNumero}${cierre}`;
    }
    return `${etiqueta} de ${evento.jugador} · ${datos.estado.puntos.A}–${datos.estado.puntos.B}`;
  }

  function pintarExtras() {
    $("[data-anot-soltar]").hidden = datos.partido.origenMarcador !== "eventos";

    const historial = $("[data-anot-historial]");
    historial.textContent = "";
    [...datos.eventos]
      .reverse()
      .slice(0, 12)
      .forEach((evento) => {
        const etiqueta = (datos.tipos.find((t) => t.clave === evento.tipo) || {}).etiqueta || evento.tipo;
        const linea = el("button", "anot-historial-linea");
        linea.type = "button";
        linea.textContent = `${evento.orden + 1}. ${etiqueta}${evento.jugador ? ` de ${evento.jugador}` : ""}`;
        // El saldo de apertura no se corrige: se suelta y se vuelve a adoptar.
        linea.disabled = evento.tipo === "ajuste";
        linea.addEventListener("click", () => abrirCorreccion(evento));
        historial.append(linea);
      });
  }

  // ---------------------------------------------------- los dos toques ---

  function elegir(jugador) {
    if (guardando || datos.estado.terminado) return;
    elegido = jugador;
    entrante = null;

    $("[data-anot-elegido]").textContent = jugador.nombre;
    $("[data-anot-cambio]").hidden = true;
    $("[data-anot-punto]").hidden = true;
    $("[data-anot-reposo]").hidden = true;
    $("[data-anot-acciones]").hidden = false;

    /*
     * Quién va en cada grupo lo dice el servidor (`punto: "pregunta"`), no una
     * lista escrita aquí: es la misma razón por la que la predicción lee
     * `aRival` en vez de repetir la regla.
     */
    const cajas = {
      siempre: $("[data-anot-tipos]"),
      pregunta: $("[data-anot-tipos-extra]")
    };
    cajas.siempre.textContent = "";
    cajas.pregunta.textContent = "";

    datos.tipos.forEach((tipo) => {
      const boton = el("button", `anot-btn anot-btn--tipo anot-btn--${tipo.clave}`);
      boton.type = "button";
      boton.append(el("span", "anot-tipo-nombre", tipo.etiqueta));
      // Sin `ayuda` el botón se queda en una línea: es lo que le devuelve el
      // suelo de 56px a `bloqueo`/`chilena`, que con las dos líneas de antes
      // nunca llegaba a aplicarse (el contenido ya pedía más).
      if (tipo.ayuda) boton.append(el("span", "anot-tipo-ayuda", tipo.ayuda));
      boton.addEventListener("click", () => elegirAccion(tipo));
      cajas[tipo.punto].append(boton);
    });
  }

  /**
   * Segundo toque. Los tipos que preguntan abren el tercero; el resto anotan.
   *
   * Quién pregunta lo dice el servidor (`punto: "pregunta"`), no una lista
   * escrita aquí: con la regla copiada a mano, añadir un tipo la dejaría
   * mintiendo — que es exactamente lo que ya pasó con «todo menos defensa
   * puntúa».
   *
   * Los dos botones del tercer toque cierran sobre `tipo`, el parámetro de esta
   * misma llamada — no sobre una variable compartida que otro gesto pudiera
   * vaciar entretanto. Antes existía `preguntando` con ese papel y un
   * `TypeError` esperaba agazapado detrás: tocar un suplente mientras la
   * pregunta seguía abierta la ponía a `null` sin cerrar los botones, y pulsar
   * «Fue punto» después reventaba leyendo `.clave` de `null` — en silencio,
   * porque la promesa rechazada no la recogía nadie. Cerrar sobre el parámetro
   * hace ese fallo irrepresentable en vez de vigilarlo con un test.
   */
  function elegirAccion(tipo) {
    if (tipo.punto !== "pregunta") return anotarPunto(tipo.clave);

    $("[data-anot-acciones]").hidden = true;
    $("[data-anot-punto]").hidden = false;
    $("[data-anot-punto-accion]").textContent = `${tipo.etiqueta} de ${elegido.nombre}`;

    const caja = $("[data-anot-punto-opciones]");
    caja.textContent = "";
    const suyo = nombreEquipo(elegido.lado);
    [
      { nombre: "Fue punto", ayuda: `Para ${suyo}`, punto: true, clase: "" },
      { nombre: "No fue punto", ayuda: "El rally siguió", punto: false, clase: " anot-btn--no" }
    ].forEach((opcion) => {
      const boton = el("button", `anot-btn anot-btn--tipo${opcion.clase}`);
      boton.type = "button";
      boton.append(el("span", "anot-tipo-nombre", opcion.nombre));
      boton.append(el("span", "anot-tipo-ayuda", opcion.ayuda));
      boton.addEventListener("click", () => anotarPunto(tipo.clave, opcion.punto));
      caja.append(boton);
    });
  }

  function cancelar() {
    elegido = null;
    entrante = null;
    $("[data-anot-acciones]").hidden = true;
    $("[data-anot-cambio]").hidden = true;
    $("[data-anot-punto]").hidden = true;
    $("[data-anot-reposo]").hidden = false;
  }

  // --------------------------------------------------------------- cambios ---

  /**
   * Tocar a un suplente abre el cambio. El segundo toque —por quién entra— cae
   * en la zona del pulgar, igual que el de un punto: es la misma gramática y el
   * mismo hueco, así que no hay nada nuevo que aprender a pleno sol.
   */
  function elegirSuplente(jugador) {
    if (guardando || datos.estado.terminado) return;
    entrante = jugador;
    elegido = null;

    $("[data-anot-entra]").textContent = jugador.nombre;
    $("[data-anot-reposo]").hidden = true;
    $("[data-anot-acciones]").hidden = true;
    /*
     * La pregunta «¿fue punto?» vive en el mismo hueco del pulgar que este
     * cambio. Sin ocultarla aquí, tocar a un suplente con la pregunta todavía
     * abierta dejaba dos bloques del pulgar apilados a la vez — el mismo hueco
     * reclamado por dos preguntas contradictorias, y el presupuesto de alto
     * que existe esta pantalla entera para respetar, roto.
     */
    $("[data-anot-punto]").hidden = true;
    $("[data-anot-cambio]").hidden = false;

    const caja = $("[data-anot-cambio-opciones]");
    caja.textContent = "";
    datos.alineacion
      .filter((fila) => fila.lado === jugador.lado)
      .forEach((fila) => {
        const boton = el("button", "anot-btn anot-btn--tipo");
        boton.type = "button";
        boton.dataset.sale = String(fila.jugador_id);
        boton.append(el("span", "anot-tipo-nombre", fila.nombre));
        boton.append(el("span", "anot-tipo-ayuda", `${fila.apellidos || ""}`.trim() || "Sale de la pista"));
        boton.addEventListener("click", () => hacerCambio(fila.jugador_id));
        caja.append(boton);
      });
  }

  async function hacerCambio(saleId) {
    if (guardando || !entrante) return;
    guardando = true;
    const entraId = entrante.id;
    cancelar();
    setError("");

    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "cambio",
        entra: entraId,
        sale: saleId
      });
    } catch (error) {
      setError(error.message);
      await recargar();
    } finally {
      guardando = false;
      pintar();
    }
  }

  /** ¿Lo último que pasó fue un cambio, y no un punto? */
  function ultimoFueCambio() {
    const cambio = (datos.cambios || [])[datos.cambios.length - 1];
    if (!cambio) return false;
    const ultimoEvento = datos.eventos[datos.eventos.length - 1];
    return cambio.trasOrden >= (ultimoEvento ? ultimoEvento.orden : -1);
  }

  /**
   * Predice el marcador con las reglas del partido para que el número se mueva
   * al instante. No duplica lógica: `applyPoint` es el mismo que usa el panel, y
   * quién se lleva el punto sale de `tipos`, que lo trae del catálogo del
   * servidor. Aquí estaba escrito a mano («todo menos defensa puntúa»), que es
   * una copia esperando a quedarse vieja.
   *
   * Con los tipos que preguntan sólo hay punto que predecir cuando la respuesta
   * ya llegó y fue que sí: sin ella, adivinar aquí sería pintar un punto que el
   * servidor puede no llegar a guardar.
   */
  function predecir(tipo, punto) {
    const meta = datos.tipos.find((t) => t.clave === tipo);
    if (!meta) return null;
    // Con los que preguntan, sólo hay punto que predecir si la respuesta fue sí.
    if (meta.punto === "pregunta" && punto !== true) return null;
    const ladoPunto = meta.aRival ? otroLado(elegido.lado) : elegido.lado;

    const fingido = {
      status: "live",
      setNumber: datos.estado.setNumero,
      points: { ...datos.estado.puntos },
      sets: { ...datos.estado.sets },
      history: [...datos.estado.historial],
      reglas: datos.partido.reglas,
      elapsedMs: 0,
      startedAt: null,
      winner: null,
      teams: { A: { name: "" }, B: { name: "" } }
    };
    return utils.applyPoint(fingido, ladoPunto, 1);
  }

  async function anotarPunto(tipo, punto) {
    if (guardando || !elegido) return;
    guardando = true;
    setError("");

    // Se capturan antes de cerrar la botonera, que limpia `elegido`.
    const jugadorId = elegido.id;
    const ordenEsperado = datos.siguienteOrden;
    // El último estado que confirmó el servidor, para poder volver a él. La
    // predicción reemplaza `datos.estado` por un objeto nuevo, así que guardar
    // la referencia al viejo basta.
    const confirmado = datos.estado;

    const prediccion = predecir(tipo, punto);
    if (prediccion) {
      datos.estado = {
        ...datos.estado,
        puntos: prediccion.points,
        sets: prediccion.sets,
        setNumero: prediccion.setNumber,
        historial: prediccion.history
      };
      $("[data-anot-puntos-a]").textContent = String(prediccion.points.A);
      $("[data-anot-puntos-b]").textContent = String(prediccion.points.B);
    }
    cancelar();

    try {
      const respuesta = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "evento",
        tipo,
        jugadorId,
        ordenEsperado: ordenEsperado,
        // Sólo viaja con los tipos que preguntan: el servidor rechaza el evento
        // si falta, y mandarlo siempre sería decidir por él.
        ...(punto === undefined ? {} : { punto })
      });
      datos = respuesta;
    } catch (error) {
      setError(error.message);
      /*
       * La predicción no valía, así que lo primero es deshacerla. Antes se
       * llamaba directamente a `recargar()`: si esa también fallaba —que es lo
       * que pasa sin cobertura, porque es la misma red— la excepción salía por
       * encima del catch, el `finally` repintaba el estado OPTIMISTA y el
       * marcador se quedaba con un punto que no existía en ninguna base de
       * datos. Un anotador que cree que está guardando y no lo está es peor que
       * uno que sabe que no puede anotar; esto era justo eso. Releer es un
       * extra, no el remedio.
       */
      datos.estado = confirmado;
      await recargarSiSePuede();
    } finally {
      guardando = false;
      pintar();
      // El retrato de quien lo hizo se sacude. Va después de pintar, cuando el
      // nodo ya está donde toca.
      cromo.vibrar(retratos.get(jugadorId));
    }
  }

  /**
   * Deshacer es una sola tecla y la decide el estado: si lo último que pasó fue
   * un cambio, deshace el cambio. Dos botones que hay que elegir a ciegas entre
   * punto y punto es justo lo que esta pantalla no puede permitirse.
   */
  async function deshacer() {
    if (guardando) return;
    if (ultimoFueCambio()) {
      guardando = true;
      setError("");
      try {
        datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
          accion: "cambio-deshacer"
        });
      } catch (error) {
        setError(error.message);
        await recargar();
      } finally {
        guardando = false;
        pintar();
      }
      return;
    }

    if (datos.eventos.length === 0) return;
    guardando = true;
    setError("");
    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "deshacer",
        ordenEsperado: datos.eventos[datos.eventos.length - 1].orden
      });
    } catch (error) {
      setError(error.message);
      await recargarSiSePuede();
    } finally {
      guardando = false;
      pintar();
    }
  }

  // ----------------------------------------------------------- corregir ---

  function abrirCorreccion(evento) {
    correccion = {
      orden: evento.orden,
      tipo: evento.tipo,
      jugadorId: evento.jugadorId,
      /*
       * «Fue punto» significa «se lo llevó el lado de quien hizo la acción»,
       * no «`ladoPunto` no es nulo». Con un tipo `aRival` (`saque_fallado`) el
       * punto es del lado CONTRARIO al del jugador aunque exista: comparar
       * sólo con `null` marcaría «Fue punto» al corregir un saque fallado
       * hacia un bloqueo sin tocar el sí/no, y el punto —que era del
       * rival— se lo llevaría el propio jugador. `ladoJugador` viaja en el
       * evento (`EventoPublico`) exactamente para esta cuenta.
       */
      punto: evento.ladoPunto !== null && evento.ladoPunto === evento.ladoJugador
    };
    $("[data-anot-corregir-titulo]").textContent = `Corregir el punto ${evento.orden + 1}`;

    const cajaTipos = $("[data-anot-corregir-tipos]");
    cajaTipos.textContent = "";
    datos.tipos.forEach((tipo) => {
      const boton = el("button", `anot-btn anot-btn--tipo anot-btn--${tipo.clave}`);
      boton.type = "button";
      boton.dataset.tipo = tipo.clave;
      boton.append(el("span", "anot-tipo-nombre", tipo.etiqueta));
      boton.addEventListener("click", () => {
        correccion.tipo = tipo.clave;
        marcarElegidos();
      });
      cajaTipos.append(boton);
    });

    const cajaQuien = $("[data-anot-corregir-jugadores]");
    cajaQuien.textContent = "";
    datos.alineacion.forEach((fila) => {
      const boton = el("button", `anot-btn anot-corregir-jugador anot-corregir-jugador--${fila.lado.toLowerCase()}`);
      boton.type = "button";
      boton.dataset.jugador = String(fila.jugador_id);
      boton.textContent = `${fila.nombre} ${fila.apellidos || ""}`.trim();
      boton.addEventListener("click", () => {
        correccion.jugadorId = fila.jugador_id;
        marcarElegidos();
      });
      cajaQuien.append(boton);
    });

    marcarElegidos();
    $("[data-anot-dialogo-corregir]").showModal();
  }

  /** Lo elegido vive en `correccion`; esto solo lo refleja en los botones. */
  function marcarElegidos() {
    const dialogo = $("[data-anot-dialogo-corregir]");
    dialogo.querySelectorAll("[data-tipo]").forEach((boton) => {
      boton.setAttribute("aria-pressed", String(boton.dataset.tipo === correccion.tipo));
    });
    dialogo.querySelectorAll("[data-jugador]").forEach((boton) => {
      boton.setAttribute("aria-pressed", String(Number(boton.dataset.jugador) === correccion.jugadorId));
    });

    /*
     * El sí/no sólo aparece con los tipos que preguntan. Con los demás, el tipo
     * ya decide y enseñar la pregunta sugeriría una elección que no existe.
     */
    const meta = datos.tipos.find((t) => t.clave === correccion.tipo);
    const pregunta = Boolean(meta && meta.punto === "pregunta");
    $("[data-anot-corregir-punto]").hidden = !pregunta;
    dialogo.querySelectorAll("[data-punto]").forEach((boton) => {
      boton.setAttribute("aria-pressed", String((boton.dataset.punto === "true") === correccion.punto));
    });
  }

  async function guardarCorreccion() {
    if (!correccion || guardando) return;
    guardando = true;
    const dialogo = $("[data-anot-dialogo-corregir]");
    try {
      const meta = datos.tipos.find((t) => t.clave === correccion.tipo);
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "corregir",
        orden: correccion.orden,
        tipo: correccion.tipo,
        jugadorId: correccion.jugadorId,
        // Sólo con los tipos que preguntan: mandarlo siempre sería decidir por
        // el servidor, y con los demás tipos el ausente («no lo toques») es lo
        // que conserva si la fila puntuó o no.
        ...(meta && meta.punto === "pregunta" ? { punto: correccion.punto } : {})
      });
      setError("");
    } catch (error) {
      setError(error.message);
    } finally {
      // Se cierra en los dos casos: el aviso vive fuera del diálogo, y dejarlo
      // abierto lo taparía.
      dialogo.close();
      correccion = null;
      guardando = false;
      pintar();
    }
  }

  // ---------------------------------------------------------- alineación ---

  function abrirAlineacion() {
    const dialogo = $("[data-anot-dialogo-alineacion]");
    const caja = $("[data-anot-plantillas]");
    caja.textContent = "";

    for (const lado of ["A", "B"]) {
      const bloque = el("fieldset", "anot-plantilla");
      bloque.append(el("legend", "", nombreEquipo(lado)));
      const enPista = new Set(datos.alineacion.filter((f) => f.lado === lado).map((f) => f.jugador_id));

      (datos.equipos[lado]?.jugadores || []).forEach((jugador) => {
        const label = el("label", "anot-check");
        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = String(jugador.id);
        input.dataset.lado = lado;
        input.checked = enPista.has(jugador.id);
        label.append(input, el("span", "", `${jugador.nombre} ${jugador.apellidos || ""}`.trim()));
        // Quién es suplente venía en la respuesta y no se pintaba, así que
        // alinear al equipo entero era igual de fácil que alinear a quien juega.
        if (jugador.esSuplente) label.append(el("span", "anot-check-nota", "suplente"));
        bloque.append(label);
      });

      caja.append(bloque);
    }

    dialogo.showModal();
  }

  async function guardarAlineacion() {
    if (guardando) return;
    guardando = true;
    const dialogo = $("[data-anot-dialogo-alineacion]");
    const marcados = [...dialogo.querySelectorAll("input[type=checkbox]")];

    try {
      for (const lado of ["A", "B"]) {
        const ids = marcados.filter((i) => i.dataset.lado === lado && i.checked).map((i) => Number(i.value));
        datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
          accion: "alineacion",
          lado,
          jugadorIds: ids
        });
      }
      dialogo.close();
      setError("");
    } catch (error) {
      setError(error.message);
    } finally {
      guardando = false;
      pintar();
    }
  }

  // --------------------------------------------------------------- carga ---

  async function recargar() {
    datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`);
  }

  /**
   * Releer para recuperarse de un fallo, sabiendo que releer también puede
   * fallar. El aviso que ya está puesto es el del fallo original, que es el que
   * cuenta: taparlo con «sin conexión» al reintentar no ayuda a nadie.
   */
  async function recargarSiSePuede() {
    try {
      await recargar();
    } catch {
      /* Sin red: nos quedamos con lo último que confirmó el servidor. */
    }
  }

  /*
   * `guardando` también aquí: un doble toque en «Seguir desde 8–6» con la red
   * lenta mandaba dos adopciones, y la segunda contestaba «este partido ya tiene
   * anotación». El anotador veía un error por haberlo hecho bien.
   */
  async function accionSimple(cuerpo) {
    if (guardando) return;
    guardando = true;
    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", cuerpo);
      setError("");
    } catch (error) {
      setError(error.message);
    } finally {
      guardando = false;
      pintar();
    }
  }

  $("[data-anot-deshacer]").addEventListener("click", deshacer);
  $("[data-anot-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-cambio-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-punto-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-alineacion]").addEventListener("click", abrirAlineacion);
  $("[data-anot-alineacion-guardar]").addEventListener("click", guardarAlineacion);
  $("[data-anot-alineacion-cancelar]").addEventListener("click", () =>
    $("[data-anot-dialogo-alineacion]").close()
  );
  $("[data-anot-corregir-guardar]").addEventListener("click", guardarCorreccion);
  $("[data-anot-corregir-cancelar]").addEventListener("click", () => $("[data-anot-dialogo-corregir]").close());
  $("[data-anot-dialogo-corregir]").querySelectorAll("[data-punto]").forEach((boton) => {
    boton.addEventListener("click", () => {
      if (!correccion) return;
      correccion.punto = boton.dataset.punto === "true";
      marcarElegidos();
    });
  });
  $("[data-anot-adoptar]").addEventListener("click", () => accionSimple({ accion: "adoptar" }));
  $("[data-anot-cero]").addEventListener("click", () => accionSimple({ accion: "adoptar", desdeCero: true }));
  $("[data-anot-soltar]").addEventListener("click", () => accionSimple({ accion: "soltar" }));

  /*
   * Al volver a la pantalla, releer una vez.
   *
   * Esta pantalla no sondea, y no va a empezar: un partido solo cambia cuando lo
   * toca quien lo está anotando, así que pedir cada pocos segundos durante seis
   * horas sería gastar por gastar. Lo que sí pasa es que el móvil se bloquea
   * entre sets, o que dos personas anotan el mismo partido sin saberlo: al
   * volver, lo que hay en pantalla puede ser de hace diez minutos y el primer
   * toque se lo lleva un conflicto de orden. Una lectura al reaparecer cuesta
   * una petición y se ahorra ese toque perdido, que es el que duele porque llega
   * justo cuando hay tres segundos para anotar.
   */
  document.addEventListener("visibilitychange", async () => {
    // `panel.isConnected`: el oyente cuelga de `document`, que sobrevive a su
    // propio panel. Si el panel ya no está en la página, esta copia del script
    // no pinta en ninguna parte y lo único que haría es gastar una petición.
    if (!panel.isConnected || document.visibilityState !== "visible" || guardando || !datos) return;
    await recargarSiSePuede();
    pintar();
  });

  alEntrar(async () => {
    if (!partidoId) {
      estadoTexto.textContent = "Falta el partido. Vuelve y elige uno.";
      return;
    }
    try {
      await recargar();
      estadoTexto.hidden = true;
      panel.hidden = false;
      pintar();
    } catch (error) {
      estadoTexto.textContent = error.message;
    }
  });
})();
