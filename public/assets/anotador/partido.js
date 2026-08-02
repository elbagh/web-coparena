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
  /** El punto que cerraría un set y espera confirmación. Nada se ha guardado. */
  let porCerrar = null;
  /** Retratos vivos por jugador: se mueven entre pista y banquillo, no se recrean. */
  const retratos = new Map();
  /** El punto que espera a que arranque el reloj. */
  let puntoEnEspera = null;
  let tictac = null;

  /** Rehacer un partido cerrado ya no es anotar: pide `partidos.editar`. */
  const puedeEditar = () => Boolean(window.CopaAuth?.state?.acceso?.permisos?.includes("partidos.editar"));

  // ------------------------------------------------------------- pintado ---

  /*
   * `relevo` gana a todos, y `fuera` gana a `decidir` — por este orden, y no
   * por convención: así decide el propio servidor. `asegurarReclamo` en
   * `api/anotacion.ts` corre delante de cualquier acción salvo la propia
   * «relevo», así que un partido que ya lleva otra persona no se puede ni
   * publicar («directo») ni decidir su marcador de a mano todavía — hay que
   * tomarlo primero. Descartado eso, un `scheduled` con marcador a mano
   * responde «no está en directo» (`PartidoNoEnDirecto`), no «hay un
   * marcador por decidir» (`MarcadorSinAdoptar`) — `registrarEvento` en
   * `_lib/eventos.ts` comprueba el status antes que el marcador. Pintar dos
   * avisos a la vez ofrecería dos salidas cuando solo una lleva a algún
   * sitio. Un partido `finished` no entra en `fuera`: ya se publicó, y el
   * servidor le contesta con un aviso distinto («ya ha terminado»), no este.
   *
   * Una sola función y no cálculos sueltos: `pintar()` la usa para saber qué
   * bloque enseñar y `mostrarError()` para saber a cuál de los cuatro avisos
   * le toca un fallo. Que puedan desacoplarse es justo el bug de esta ronda.
   */
  function estadoBloque() {
    const relevo = datos.anotador ? datos.anotador.puedeAnotar === false : false;
    const fuera = !relevo && datos.partido.status === "scheduled";
    const decidir = !relevo && !fuera && Boolean(datos.pendienteDeAdoptar);
    return { relevo, fuera, decidir };
  }

  /**
   * El aviso de un fallo vive en cuatro sitios, uno por bloque que puede estar
   * en pantalla, no en uno: `[data-anot-error]` (el de siempre, en
   * `core.js`) cuelga de `.anot-pulgar`, que `pintar()` oculta durante
   * `relevo`, `fuera` y `decidir` — un fallo que cae ahí no se ve, que es
   * justo lo que este aviso existe para evitar («Tomar el relevo», «Poner en
   * directo» y «Adoptar»/«Empezar en 0–0» respondían 409 en silencio). Se
   * elige con la misma cuenta que decide qué bloque se pinta, no mirando qué
   * anda `hidden` en el DOM: así no puede desacoplarse de `pintar()` el día
   * que cambie el orden de estados.
   *
   * Los otros tres huecos se limpian siempre, para que un aviso de un estado
   * anterior no sobreviva al cambio que lo dejó sin sitio.
   */
  function mostrarError(mensaje) {
    const { relevo, fuera, decidir } = datos
      ? estadoBloque()
      : { relevo: false, fuera: false, decidir: false };
    const propio = relevo
      ? $("[data-anot-error-relevo]")
      : fuera
        ? $("[data-anot-error-fuera]")
        : decidir
          ? $("[data-anot-error-decision]")
          : null;

    for (const otro of [
      $("[data-anot-error-relevo]"),
      $("[data-anot-error-fuera]"),
      $("[data-anot-error-decision]")
    ]) {
      if (otro && otro !== propio) {
        otro.textContent = "";
        otro.hidden = true;
      }
    }

    if (propio) {
      propio.textContent = mensaje || "";
      propio.hidden = !mensaje;
      setError(""); // la franja del pulgar no se queda con el aviso de otro bloque
      return;
    }
    setError(mensaje);
  }

  const relojCorriendo = () => Boolean(datos.partido.startedAt);
  const relojSinEstrenar = () => !datos.partido.startedAt && !datos.partido.elapsedMs;

  /**
   * El reloj lo pinta el navegador desde el ancla del servidor.
   *
   * `elapsed()` de match-utils.js ya sabe la cuenta —acumulado más el tramo en
   * curso—, así que aquí no se repite: es la misma que usa el panel.
   */
  function pintarReloj() {
    const caja = $("[data-anot-reloj]");
    const pausa = $("[data-anot-reloj-pausa]");
    const iniciar = $("[data-anot-reloj-iniciar]");
    const fuera = datos.partido.status !== "live";

    iniciar.hidden = fuera || !relojSinEstrenar();
    caja.hidden = fuera || relojSinEstrenar();
    pausa.hidden = caja.hidden;

    if (caja.hidden) return;

    const ms = utils.elapsed({
      status: "live",
      startedAt: datos.partido.startedAt,
      elapsedMs: datos.partido.elapsedMs
    });
    texto(caja, utils.formatClock(ms));
    pausa.textContent = relojCorriendo() ? "⏸" : "▶";
    pausa.setAttribute("aria-label", relojCorriendo() ? "Pausar el cronómetro" : "Reanudar el cronómetro");
  }

  /* Un tick por segundo, y solo mientras corre: parado no hay nada que mover. */
  function vigilarReloj() {
    clearInterval(tictac);
    if (!datos || !relojCorriendo() || document.visibilityState === "hidden") return;
    tictac = setInterval(pintarReloj, 1000);
  }

  function pintar() {
    if (!datos) return;
    const { estado, alineacion } = datos;
    const terminado = estado.terminado;
    const { relevo, fuera, decidir } = estadoBloque();

    /*
     * Los números grandes son los puntos del set, salvo en dos casos:
     *   - terminado: son los SETS, porque los puntos volvieron a cero al cerrarse
     *     el último y ya no cuentan nada.
     *   - pendiente de decidir: son los del panel, que es por donde va el partido
     *     de verdad. Pintar el 0–0 del log al lado de un aviso que dice «va 12–9»
     *     es contar dos cosas distintas en la misma pantalla.
     */
    const grandes = terminado ? estado.sets : decidir ? datos.marcadorPanel.puntos : estado.puntos;
    pintarRotulo(terminado, decidir);
    $("[data-anot-puntos-a]").textContent = String(grandes.A);
    $("[data-anot-puntos-b]").textContent = String(grandes.B);

    const sets = decidir ? datos.marcadorPanel.sets : estado.sets;
    // `fuera` antes que el set/objetivo normal: «Set 1 · a 21» encima de «no
    // está en directo» leía como que el partido ya iba por ahí sin publicarse.
    $("[data-anot-detalle]").textContent = terminado
      ? `Terminado · ganó ${nombreEquipo(estado.winner)}`
      : fuera
        ? "Sin empezar"
        : decidir
          ? `Sets ${sets.A}–${sets.B} · sin anotar`
          : `Set ${estado.setNumero} · sets ${sets.A}–${sets.B} · a ${objetivo()}`;

    const parciales = $("[data-anot-parciales]");
    parciales.hidden = estado.historial.length === 0;
    parciales.textContent = estado.historial.map((set) => `${set.a}–${set.b}`).join(" · ");

    /*
     * Cuatro estados excluyentes, por este orden de prioridad: el relevo, fuera
     * de directo, decidiendo el marcador de a mano, o anotando. La pista solo se
     * pinta en el último: en los otros tres sus botones responderían 409.
     *
     * El relevo gana incluso a «fuera»: `asegurarReclamo` en `api/anotacion.ts`
     * corre delante de cualquier acción salvo la propia «relevo» —incluida
     * «directo»—, así que un partido que ya lleva otra persona no se puede ni
     * publicar todavía sin tomarlo primero. `estadoBloque()` deja `fuera` y
     * `decidir` ya excluyentes entre sí.
     */
    pintarRelevo(relevo);
    pintarDecision(decidir);
    $("[data-anot-fuera]").hidden = relevo || !fuera;
    $("[data-anot-pista]").hidden = relevo || decidir || fuera;
    $("[data-anot-pulgar]").hidden = relevo || decidir || fuera;

    pintarPista(alineacion, terminado);
    pintarReposo(terminado);
    pintarExtras();
    pintarReloj();
    vigilarReloj();
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

  /**
   * El rótulo en el flujo y la pestaña de punto de set, que son dos cosas.
   *
   * El rótulo dice qué son los números grandes cuando no son los puntos del set
   * en juego; la pestaña avisa de que uno cierra. Nunca coinciden —a un punto del
   * cierre el partido no ha terminado ni lo lleva el panel—, pero van en
   * elementos distintos porque la pestaña no puede ocupar sitio en el flujo.
   */
  function pintarRotulo(terminado, decidir) {
    const rotulo = $("[data-anot-rotulo]");
    rotulo.hidden = !terminado && !decidir;
    texto(rotulo, terminado ? "Sets" : "Lo lleva el panel");

    const pestana = $("[data-anot-punto-set]");
    const aviso = terminado || decidir ? null : puntoDeSet();
    pestana.hidden = !aviso;
    if (!aviso) return pestana.removeAttribute("data-lado");

    const que = aviso.partido ? "Punto de partido" : "Punto de set";
    // Con dos de ventaja sólo puede estar en punto de set quien va por delante.
    // Con uno —que es una regla legítima y algún grupo la usa— pueden estarlo los
    // dos a la vez, y entonces poner un nombre sería mentir.
    if (aviso.lados.length > 1) {
      pestana.removeAttribute("data-lado");
      return texto(pestana, `${que} para los dos`);
    }
    pestana.dataset.lado = aviso.lados[0];
    texto(pestana, `${que} · ${nombreEquipo(aviso.lados[0])}`);
  }

  /**
   * ¿A quién le basta un punto para cerrar el set?
   *
   * Se resuelve simulando el punto con las reglas del propio partido en vez de
   * comparar el tanteo contra el objetivo: la ventaja mínima también decide —a
   * 20–20 no cierra nadie con uno— y esa regla ya vive en `applyPoint`. Escribirla
   * aquí otra vez sería la tercera copia.
   */
  function puntoDeSet() {
    if (datos.estado.terminado) return null;
    const lados = ["A", "B"].filter((lado) => cierraSet(utils.applyPoint(partidoFingido(), lado, 1)));
    if (lados.length === 0) return null;
    return {
      lados,
      partido: lados.every((lado) => utils.applyPoint(partidoFingido(), lado, 1).status === "finished")
    };
  }

  /** El estado actual como partido de `match-utils`, para poder simular sobre él. */
  const partidoFingido = () => ({
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
  });

  /** El parcial se guarda en `history` justo al cerrarse el set: si creció, cerró. */
  const cierraSet = (prediccion) =>
    Boolean(prediccion) && prediccion.history.length > datos.estado.historial.length;

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

  /**
   * La hora de una marca de tiempo del servidor.
   *
   * `updated_at` llega de dos sitios: `new Date().toISOString()` desde el código
   * y `datetime('now')` desde el DEFAULT de SQLite, que no lleva ni «T» ni «Z» y
   * es UTC. Sin normalizarla, el segundo caso da «Invalid Date» en unos motores
   * y una hora local equivocada en otros.
   */
  const horaDe = (marca) => {
    if (!marca) return "";
    const fecha = new Date(/[TZ]/.test(marca) ? marca : `${marca.replace(" ", "T")}Z`);
    if (Number.isNaN(fecha.getTime())) return "";
    return new Intl.DateTimeFormat("es", { hour: "2-digit", minute: "2-digit" }).format(fecha);
  };

  function pintarRelevo(relevo) {
    const caja = $("[data-anot-relevo]");
    caja.hidden = !relevo;
    if (!relevo) return;

    const quien = datos.anotador.nombre || "otra persona";
    const hora = horaDe(datos.ultimaActividad);
    $("[data-anot-relevo-titulo]").textContent = `Lo lleva ${quien}`;
    /*
     * La hora no se le atribuye a nadie. `ultimaActividad` es
     * `partidos.updated_at`, que mueve cualquier escritura sobre el partido; el
     * relevo, que no la toca, dejaba a esta frase diciendo «su último punto» de
     * una hora que era del anotador anterior. Se dice lo que la marca sabe: la
     * última vez que este partido se movió. Es lo que hace falta para decidir si
     * quien lo lleva sigue ahí.
     */
    $("[data-anot-relevo-texto]").textContent = hora
      ? `Este partido se movió por última vez a las ${hora}. Si tomas el relevo, ${quien} dejará de poder anotar este partido.`
      : `Si tomas el relevo, ${quien} dejará de poder anotar este partido.`;
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
    porCerrar = null;

    $("[data-anot-elegido]").textContent = jugador.nombre;
    $("[data-anot-cambio]").hidden = true;
    $("[data-anot-punto]").hidden = true;
    $("[data-anot-cierre]").hidden = true;
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
    porCerrar = null;
    $("[data-anot-acciones]").hidden = true;
    $("[data-anot-cambio]").hidden = true;
    $("[data-anot-punto]").hidden = true;
    $("[data-anot-cierre]").hidden = true;
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
    porCerrar = null;

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
    $("[data-anot-cierre]").hidden = true;
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
    mostrarError("");

    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "cambio",
        entra: entraId,
        sale: saleId
      });
    } catch (error) {
      mostrarError(error.message);
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
    return utils.applyPoint(partidoFingido(), ladoPunto, 1);
  }

  /**
   * El punto cierra un set: se pregunta antes de mandarlo.
   *
   * Nada se ha guardado todavía, así que cancelar no deja rastro — ese punto no
   * llegó a existir. Es lo que separa esto de «deshacer»: deshacer un cierre
   * devuelve los puntos a 0–0 en la pantalla de todo el mundo y puede haber
   * movido ya el cuadro.
   */
  function pedirCierre(tipo, punto, prediccion) {
    porCerrar = { tipo, punto };
    const parcial = prediccion.history[prediccion.history.length - 1];
    const gana = prediccion.status === "finished";
    const accion = (datos.tipos.find((t) => t.clave === tipo) || {}).etiqueta || tipo;

    $("[data-anot-reposo]").hidden = true;
    $("[data-anot-acciones]").hidden = true;
    $("[data-anot-cambio]").hidden = true;
    $("[data-anot-punto]").hidden = true;
    $("[data-anot-cierre]").hidden = false;

    texto($("[data-anot-cierre-titulo]"), gana ? "¿Cierras el partido?" : `¿Cierras el set ${datos.estado.setNumero}?`);
    texto(
      $("[data-anot-cierre-marcador]"),
      `${accion} de ${elegido.nombre}. El set quedaría ${parcial.a}–${parcial.b}.`
    );
    texto($("[data-anot-cierre-confirmar-texto]"), gana ? "Cerrar el partido" : "Cerrar el set");
    texto(
      $("[data-anot-cierre-confirmar-ayuda]"),
      gana ? `Gana ${nombreEquipo(prediccion.winner)}` : "Se anota el punto y sube el set"
    );
  }

  async function anotarPunto(tipo, punto, cierreConfirmado) {
    if (guardando || !elegido) return;

    /*
     * El reloj sin estrenar para el primer punto. No es un cerrojo de servidor a
     * propósito: lo único que estropea anotar sin reloj es la duración del
     * partido, y un 409 más sería otra forma de que la franja del pulgar se
     * quede muerta a pie de pista. Va antes que la pregunta de cierre: el
     * primer punto del partido nunca puede ser el que cierra un set.
     */
    if (relojSinEstrenar()) {
      puntoEnEspera = { tipo, punto, jugador: elegido };
      cancelar();
      $("[data-anot-dialogo-reloj]").showModal();
      return;
    }

    /*
     * Un punto que cierra un set se pregunta antes de mandarse. Quien anota está
     * de pie al sol con tres segundos entre punto y punto: puede haber atribuido
     * mal el anterior o haber pulsado dos veces, y cerrar un set a destiempo es
     * lo más caro de deshacer que hay aquí.
     *
     * La pregunta va delante de la petición y no después: así cancelar no deja
     * rastro en ninguna parte. El pliegue del servidor no cambia — para él este
     * punto sigue siendo el punto que cierra el set.
     */
    if (!cierreConfirmado) {
      const cierre = predecir(tipo, punto);
      if (cierraSet(cierre)) return pedirCierre(tipo, punto, cierre);
    }
    porCerrar = null;

    await enviarPunto(tipo, punto);
  }

  /**
   * El envío de verdad, sin la comprobación del reloj ni la del cierre: al
   * confirmar el diálogo de arranque se llega aquí directamente, porque esa
   * comprobación ya se hizo —y repetirla leería el mismo `datos.partido` de
   * antes de arrancar, así que volvería a preguntar en vez de anotar el punto
   * que la pregunta dejó pendiente—.
   */
  async function enviarPunto(tipo, punto) {
    guardando = true;
    mostrarError("");

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
      mostrarError(error.message);
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
      /*
       * El retrato de quien lo hizo reacciona. Va después de pintar, cuando el
       * nodo ya está donde toca.
       *
       * Con los tipos que dan el punto al rival —el saque fallado y el error no
       * forzado— la marca es de fallo y no la sacudida, que es la de celebrar.
       * Quién es cuál lo dice `aRival` del catálogo del servidor, igual que en
       * `predecir`: es la misma regla que allí decide de quién es el punto, así
       * que la pantalla no vuelve a escribirla. Y es lo mismo que hace
       * `/directo/`, para que quien anota y quien mira vean lo mismo.
       */
      const meta = datos.tipos.find((t) => t.clave === tipo);
      const retrato = retratos.get(jugadorId);
      if (meta && meta.aRival) cromo.fallar(retrato);
      else cromo.vibrar(retrato);
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
      mostrarError("");
      try {
        datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
          accion: "cambio-deshacer"
        });
      } catch (error) {
        mostrarError(error.message);
        await recargar();
      } finally {
        guardando = false;
        pintar();
      }
      return;
    }

    if (datos.eventos.length === 0) return;
    guardando = true;
    mostrarError("");
    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "deshacer",
        ordenEsperado: datos.eventos[datos.eventos.length - 1].orden
      });
    } catch (error) {
      mostrarError(error.message);
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
        ordenEsperado: datos.siguienteOrden,
        tipo: correccion.tipo,
        jugadorId: correccion.jugadorId,
        // Sólo con los tipos que preguntan: mandarlo siempre sería decidir por
        // el servidor, y con los demás tipos el ausente («no lo toques») es lo
        // que conserva si la fila puntuó o no.
        ...(meta && meta.punto === "pregunta" ? { punto: correccion.punto } : {})
      });
      mostrarError("");
    } catch (error) {
      mostrarError(error.message);
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
      mostrarError("");
    } catch (error) {
      mostrarError(error.message);
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
   *
   * Devuelve si la petición llegó bien. El arranque del reloj lo usa para saber
   * si toca anotar el punto que lo disparó: mirar `datos.partido.startedAt` tras
   * la respuesta no vale, porque nada garantiza que el cuerpo devuelto refleje
   * ese arranque concreto y no otro cambio de por medio. Que la petición no haya
   * lanzado es la señal directa.
   */
  async function accionSimple(cuerpo) {
    if (guardando) return false;
    guardando = true;
    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", cuerpo);
      mostrarError("");
      return true;
    } catch (error) {
      mostrarError(error.message);
      return false;
    } finally {
      guardando = false;
      pintar();
    }
  }

  // ------------------------------------------------------ poner en directo ---

  /**
   * El servidor rechaza el primer punto de un partido `scheduled`
   * (`PartidoNoEnDirecto`) para que anotar no publique el partido sin querer.
   * Este diálogo es esa decisión, tomada a propósito: una casilla ancha que hay
   * que marcar, no un segundo diálogo — dos seguidos en un móvil al sol se
   * despachan a ciegas. Se resetea cada vez que se abre, para que confirmar sin
   * mirar no sea posible por venir ya marcada de la vez anterior.
   */
  function abrirDirecto() {
    if (guardando) return;
    const acepto = $("[data-anot-directo-acepto]");
    acepto.checked = false;
    $("[data-anot-directo-confirmar]").disabled = true;
    $("[data-anot-directo-cruce]").textContent = `${nombreEquipo("A")} — ${nombreEquipo("B")}`;
    $("[data-anot-dialogo-directo]").showModal();
  }

  $("[data-anot-deshacer]").addEventListener("click", deshacer);
  $("[data-anot-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-cambio-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-punto-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-cierre-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-cierre-confirmar]").addEventListener("click", () => {
    if (porCerrar) anotarPunto(porCerrar.tipo, porCerrar.punto, true);
  });
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
  $("[data-anot-poner-directo]").addEventListener("click", abrirDirecto);
  $("[data-anot-directo-acepto]").addEventListener("change", (evento) => {
    $("[data-anot-directo-confirmar]").disabled = !evento.target.checked;
  });
  $("[data-anot-directo-cancelar]").addEventListener("click", () => $("[data-anot-dialogo-directo]").close());
  $("[data-anot-directo-confirmar]").addEventListener("click", async () => {
    $("[data-anot-dialogo-directo]").close();
    await accionSimple({ accion: "directo" });
  });

  $("[data-anot-reloj-iniciar]").addEventListener("click", () =>
    accionSimple({ accion: "cronometro", marcha: true })
  );
  $("[data-anot-reloj-pausa]").addEventListener("click", () =>
    accionSimple({ accion: "cronometro", marcha: !relojCorriendo() })
  );
  $("[data-anot-reloj-cancelar]").addEventListener("click", () => {
    puntoEnEspera = null;
    $("[data-anot-dialogo-reloj]").close();
  });
  $("[data-anot-reloj-confirmar]").addEventListener("click", async () => {
    $("[data-anot-dialogo-reloj]").close();
    const espera = puntoEnEspera;
    puntoEnEspera = null;
    const arrancado = await accionSimple({ accion: "cronometro", marcha: true });
    // El punto que abrió el diálogo se anota: descartarlo sería perderlo. Pero
    // solo si el reloj arrancó de verdad — si la petición falló, anotar encima
    // dejaría un punto guardado con el reloj todavía sin estrenar, y el aviso ya
    // dicho por `accionSimple` sería lo único que quedara sin explicar por qué.
    // Va a `enviarPunto` y no a `anotarPunto`: la comprobación del reloj ya se
    // hizo aquí, y volver a pasar por ella preguntaría otra vez.
    if (arrancado && espera) {
      elegido = espera.jugador;
      await enviarPunto(espera.tipo, espera.punto);
    }
  });

  document.addEventListener("visibilitychange", vigilarReloj);

  $("[data-anot-relevo-tomar]").addEventListener("click", () => accionSimple({ accion: "relevo" }));

  /*
   * Al volver a la pantalla, releer una vez.
   *
   * Esta pantalla no sondea, y no va a empezar: un partido solo cambia cuando lo
   * toca quien lo está anotando, así que pedir cada pocos segundos durante seis
   * horas sería gastar por gastar. Lo que sí pasa es que el móvil se bloquea
   * entre sets, o que alguien ha tomado el relevo mientras tanto: al volver, lo
   * que hay en pantalla puede ser de hace diez minutos y el primer toque se lo
   * lleva un 409. Una lectura al reaparecer cuesta una petición y se ahorra ese
   * toque perdido, que es el que duele porque llega justo cuando hay tres
   * segundos para anotar.
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
