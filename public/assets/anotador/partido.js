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
 */
(() => {
  const panel = document.querySelector("[data-anot-panel]");
  if (!panel || !window.CopaAnotador) return;

  const { api, setError, alEntrar } = window.CopaAnotador;
  const utils = window.CopaArenaMatches;

  const partidoId = new URLSearchParams(location.search).get("id") || "";
  const estadoTexto = document.querySelector("[data-anot-estado]");

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, clase, texto) => {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };

  let datos = null;
  let elegido = null;
  let guardando = false;

  // ------------------------------------------------------------- pintado ---

  function pintar() {
    if (!datos) return;
    const { estado, alineacion } = datos;

    $("[data-anot-nombre-a]").textContent = nombreEquipo("A");
    $("[data-anot-nombre-b]").textContent = nombreEquipo("B");
    $("[data-anot-puntos-a]").textContent = String(estado.puntos.A);
    $("[data-anot-puntos-b]").textContent = String(estado.puntos.B);

    const objetivo = utils?.setTarget
      ? utils.setTarget({ reglas: datos.partido.reglas, setNumber: estado.setNumero }, estado.setNumero)
      : datos.partido.reglas.puntosPorSet;
    $("[data-anot-detalle]").textContent = estado.terminado
      ? `Terminado · ganó ${nombreEquipo(estado.winner)}`
      : `Set ${estado.setNumero} · sets ${estado.sets.A}–${estado.sets.B} · a ${objetivo}`;

    pintarPista(alineacion);
    pintarReposo();
    pintarExtras();
  }

  const nombreEquipo = (lado) => datos.equipos[lado]?.nombre || (lado === "A" ? "Equipo A" : "Equipo B");

  function pintarPista(alineacion) {
    for (const lado of ["A", "B"]) {
      const caja = $(`[data-anot-mitad-${lado.toLowerCase()}]`);
      caja.textContent = "";
      const enPista = alineacion.filter((fila) => fila.lado === lado);

      if (enPista.length === 0) {
        caja.append(el("p", "anot-sin-alineacion", "Nadie en pista. Márcalo en «Más»."));
        continue;
      }

      enPista.forEach((fila) => {
        const boton = el("button", `anot-jugador anot-jugador--${lado.toLowerCase()}`);
        boton.type = "button";
        boton.append(el("span", "anot-jugador-nombre", fila.nombre));
        boton.addEventListener("click", () => elegir(fila, lado));
        caja.append(boton);
      });
    }
  }

  function pintarReposo() {
    const ultimo = datos.eventos[datos.eventos.length - 1] || null;
    const texto = $("[data-anot-ultimo]");
    const deshacer = $("[data-anot-deshacer]");

    if (!ultimo) {
      texto.textContent = "Sin puntos todavía.";
      deshacer.disabled = true;
      return;
    }

    const etiqueta = (datos.tipos.find((t) => t.clave === ultimo.tipo) || {}).etiqueta || ultimo.tipo;
    texto.textContent = ultimo.jugador
      ? `${etiqueta} de ${ultimo.jugador} · ${datos.estado.puntos.A}–${datos.estado.puntos.B}`
      : `Marcador adoptado · ${datos.estado.puntos.A}–${datos.estado.puntos.B}`;
    deshacer.disabled = guardando;
  }

  function pintarExtras() {
    // Adoptar solo tiene sentido si venía llevándose a mano y hay algo que heredar.
    const sinLog = datos.eventos.length === 0;
    const conMarcador = datos.estado.puntos.A + datos.estado.puntos.B + datos.estado.sets.A + datos.estado.sets.B > 0;
    $("[data-anot-adoptar]").hidden = !(sinLog && conMarcador);
    $("[data-anot-soltar]").hidden = datos.partido.origenMarcador !== "eventos";

    const historial = $("[data-anot-historial]");
    historial.textContent = "";
    [...datos.eventos]
      .reverse()
      .slice(0, 12)
      .forEach((evento) => {
        const linea = el("p", "anot-historial-linea");
        const etiqueta = (datos.tipos.find((t) => t.clave === evento.tipo) || {}).etiqueta || evento.tipo;
        linea.textContent = `${evento.orden + 1}. ${etiqueta}${evento.jugador ? ` de ${evento.jugador}` : ""}`;
        historial.append(linea);
      });
  }

  // ---------------------------------------------------- los dos toques ---

  function elegir(fila, lado) {
    if (guardando || datos.estado.terminado) return;
    elegido = { ...fila, lado };

    $("[data-anot-elegido]").textContent = fila.nombre;
    $("[data-anot-reposo]").hidden = true;
    $("[data-anot-acciones]").hidden = false;

    const caja = $("[data-anot-tipos]");
    caja.textContent = "";
    datos.tipos.forEach((tipo) => {
      const boton = el("button", `anot-btn anot-btn--tipo anot-btn--${tipo.clave}`);
      boton.type = "button";
      boton.append(el("span", "anot-tipo-nombre", tipo.etiqueta));
      boton.append(el("span", "anot-tipo-ayuda", tipo.ayuda));
      boton.addEventListener("click", () => anotarPunto(tipo.clave));
      caja.append(boton);
    });
  }

  function cancelar() {
    elegido = null;
    $("[data-anot-acciones]").hidden = true;
    $("[data-anot-reposo]").hidden = false;
  }

  /**
   * Predice el marcador con las reglas del partido para que el número se mueva
   * al instante. No duplica lógica: `applyPoint` es el mismo que usa el panel.
   */
  function predecir(tipo) {
    if (!utils?.applyPoint) return null;
    const puntua = tipo !== "defensa";
    if (!puntua) return null;
    const ladoPunto = tipo === "error" ? (elegido.lado === "A" ? "B" : "A") : elegido.lado;

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

  async function anotarPunto(tipo) {
    if (guardando || !elegido) return;
    guardando = true;
    setError("");

    // Se capturan antes de cerrar la botonera, que limpia `elegido`.
    const jugadorId = elegido.jugador_id;
    const ordenEsperado = datos.siguienteOrden;

    const prediccion = predecir(tipo);
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
        ordenEsperado: ordenEsperado
      });
      datos = respuesta;
    } catch (error) {
      setError(error.message);
      // La predicción no valía: manda lo que diga el servidor.
      await recargar();
    } finally {
      guardando = false;
      pintar();
    }
  }

  async function deshacer() {
    if (guardando || datos.eventos.length === 0) return;
    guardando = true;
    setError("");
    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", {
        accion: "deshacer",
        ordenEsperado: datos.eventos[datos.eventos.length - 1].orden
      });
    } catch (error) {
      setError(error.message);
      await recargar();
    } finally {
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
        label.append(input, el("span", "", jugador.nombre));
        bloque.append(label);
      });

      caja.append(bloque);
    }

    dialogo.showModal();
  }

  async function guardarAlineacion() {
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
      pintar();
    } catch (error) {
      setError(error.message);
    }
  }

  // --------------------------------------------------------------- carga ---

  async function recargar() {
    datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`);
  }

  async function accionSimple(accion) {
    try {
      datos = await api(`/api/anotacion?partido=${encodeURIComponent(partidoId)}`, "POST", { accion });
      pintar();
    } catch (error) {
      setError(error.message);
    }
  }

  $("[data-anot-deshacer]").addEventListener("click", deshacer);
  $("[data-anot-cancelar]").addEventListener("click", cancelar);
  $("[data-anot-alineacion]").addEventListener("click", abrirAlineacion);
  $("[data-anot-alineacion-guardar]").addEventListener("click", guardarAlineacion);
  $("[data-anot-alineacion-cancelar]").addEventListener("click", () =>
    $("[data-anot-dialogo-alineacion]").close()
  );
  $("[data-anot-adoptar]").addEventListener("click", () => accionSimple("adoptar"));
  $("[data-anot-soltar]").addEventListener("click", () => accionSimple("soltar"));

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
