/*
 * /admin/torneo/ — el formato: fases, grupos, reglas y clasificación.
 *
 * Va aparte de torneo.js, que lleva el sorteo suelto y el marcador en vivo. Son
 * dos responsabilidades distintas: aquí se decide cómo es el torneo, allí se
 * juega. Los dos son IIFE sobre CopaAdmin, como el resto del panel.
 *
 * Todo lo que se pinta viene de GET /api/admin/torneo, incluida la clasificación
 * de cada grupo, que el servidor calcula desde los partidos terminados. Aquí no
 * se cuenta ni un punto: repetir esa lógica en el cliente sería garantizar que
 * un día las dos tablas dejen de coincidir.
 */
(() => {
  const raiz = document.querySelector("[data-formato-fases]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, apiJson, onReady, setError, el, clear, boton, etiqueta, limpiar, confirmar } = window.CopaAdmin;

  const estado = document.querySelector("[data-formato-status]");
  const dialogoFase = document.querySelector("[data-fase-dialog]");
  const dialogoGrupo = document.querySelector("[data-grupo-dialog]");

  let torneo = { fases: [], equipos: [], criterios: [] };
  let faseEnEdicion = null;
  let grupoEnEdicion = null;
  let faseDelGrupo = null;

  const campoFase = (nombre) => dialogoFase?.querySelector(`[data-fase-field="${nombre}"]`);
  const campoGrupo = (nombre) => dialogoGrupo?.querySelector(`[data-grupo-field="${nombre}"]`);

  // -------------------------------------------------------------- carga ---

  async function cargar() {
    torneo = await api("/api/admin/torneo");
    pintar();
  }

  onReady(cargar);

  function pintar() {
    clear(raiz);

    if (estado) {
      const fases = torneo.fases || [];
      estado.textContent = fases.length === 0 ? "Todavía no hay ninguna fase." : `${fases.length} fase(s)`;
    }

    (torneo.fases || []).forEach((fase) => raiz.append(tarjetaFase(fase)));
  }

  // -------------------------------------------------------------- fases ---

  function tarjetaFase(fase) {
    const caja = el("section", "torneo-fase");

    const cabecera = el("div", "torneo-fase-head");
    const titulo = el("div", "torneo-fase-titulo");
    titulo.append(
      el("h3", "", fase.nombre),
      etiqueta(fase.tipo === "grupos" ? "Grupos" : "Eliminatoria", fase.tipo === "grupos" ? "info" : "ok")
    );
    cabecera.append(titulo, accionesDeFase(fase));
    const resumen = resumenDeReglas(fase.reglas, fase.tipo, fase.clasifican);
    caja.append(
      cabecera,
      el("p", "admin-hint", fase.repesca > 0 ? `${resumen} + ${fase.repesca} de repesca` : resumen)
    );

    if (fase.tipo === "grupos") {
      const grupos = el("div", "torneo-grupos");
      if (fase.grupos.length === 0) {
        grupos.append(el("p", "admin-empty", "Esta fase todavía no tiene grupos."));
      } else {
        fase.grupos.forEach((grupo) => grupos.append(tarjetaGrupo(fase, grupo)));
      }
      caja.append(grupos);
    } else {
      caja.append(cuadroDeFase(fase));
    }

    return caja;
  }

  function accionesDeFase(fase) {
    const acciones = el("div", "admin-row-actions");

    if (fase.tipo === "grupos") {
      acciones.append(
        boton("+ Grupo", () => abrirGrupo(fase, null)),
        boton("Generar calendario", () => generarLiga(fase))
      );
    } else {
      /*
       * El tamaño va en un desplegable al lado del botón, no en un prompt: el
       * panel no usa los diálogos del navegador (ver `confirmar` en core.js), y
       * además así se ve de un vistazo qué tamaños son válidos.
       */
      const tamano = document.createElement("select");
      tamano.className = "admin-select admin-select--sm";
      tamano.setAttribute("aria-label", `Tamaño del cuadro de ${fase.nombre}`);
      [2, 4, 8, 16, 32].forEach((n) => {
        const option = document.createElement("option");
        option.value = String(n);
        option.textContent = `${n} equipos`;
        if (n === 8) option.selected = true;
        tamano.append(option);
      });

      /*
       * El tercer puesto es una opción, no una pregunta del diálogo de
       * confirmación: allí «Cancelar» significa «no generes nada», y usarlo como
       * «genera sin tercer puesto» haría que cancelar creara el cuadro igual.
       */
      const tercero = el("label", "torneo-opcion");
      const check = document.createElement("input");
      check.type = "checkbox";
      tercero.append(check, el("span", "", "con 3.er puesto"));

      acciones.append(
        tamano,
        tercero,
        boton("Generar cuadro", () => generarCuadro(fase, Number(tamano.value), check.checked)),
        boton("Sembrar", () => sembrar(fase))
      );
    }

    acciones.append(
      boton("Editar", () => abrirFase(fase)),
      boton("Borrar", () => borrarFase(fase), "admin-btn admin-btn--sm admin-btn--danger")
    );
    return acciones;
  }

  /** Una línea que resume el formato sin obligar a abrir el diálogo. */
  function resumenDeReglas(reglas, tipo, clasifican) {
    const p = reglas.partido;
    const maximos = p.sets * 2 - 1;
    const formato =
      p.sets === 1
        ? `A un set de ${p.puntosPorSet}`
        : `Al mejor de ${maximos} · ${p.puntosPorSet} y el último a ${p.puntosSetDecisivo}`;
    const ventaja = `${p.diferencia} de ventaja`;
    if (tipo !== "grupos") return `${formato} · ${ventaja}`;

    const c = reglas.clasificacion;
    return `${formato} · ${ventaja} · victoria ${c.puntosVictoria} (${c.puntosVictoriaAjustada} en el decisivo) · clasifican ${clasifican}`;
  }

  // ------------------------------------------------------------- grupos ---

  function tarjetaGrupo(fase, grupo) {
    const caja = el("div", "torneo-grupo");

    const cabecera = el("div", "torneo-grupo-head");
    const titulo = el("div", "torneo-grupo-titulo");
    titulo.append(el("h4", "", grupo.nombre));
    // Que un grupo tenga reglas propias cambia cómo se juega: se dice.
    if (grupo.reglasPropias) titulo.append(etiqueta("Reglas propias", "warn"));
    // Y que tenga su propio cupo cambia quién pasa, que es más gordo todavía.
    if (grupo.clasificanPropio != null) titulo.append(etiqueta(`Pasan ${grupo.clasificanPropio}`, "info"));
    if (grupo.enRepesca === false) titulo.append(etiqueta("Sin repesca", "warn"));
    cabecera.append(
      titulo,
      celdaAcciones(
        boton("Editar", () => abrirGrupo(fase, grupo)),
        boton("Borrar", () => borrarGrupo(grupo), "admin-btn admin-btn--sm admin-btn--danger")
      )
    );
    caja.append(cabecera);

    if (grupo.reglasPropias) {
      caja.append(el("p", "admin-hint", resumenDeReglas(grupo.reglas, "eliminatoria", 0)));
    }

    caja.append(chipsDeEquipos(grupo), selectorDeEquipo(fase, grupo));
    if (grupo.equipos.length > 0) caja.append(tablaClasificacion(grupo));

    return caja;
  }

  function chipsDeEquipos(grupo) {
    const lista = el("ul", "torneo-chips");
    if (grupo.equipos.length === 0) {
      lista.append(el("li", "admin-hint", "Sin equipos todavía."));
      return lista;
    }

    grupo.equipos.forEach((equipo) => {
      const item = el("li", `torneo-chip${equipo.retirado ? " is-retirado" : ""}`);
      if (equipo.retirado) {
        const cruz = el("span", "torneo-chip-cruz", "✕");
        cruz.setAttribute("aria-hidden", "true");
        item.append(cruz);
      }
      item.append(el("span", "", equipo.nombre));

      /*
       * Retirar no es sacar del grupo: el equipo sigue en la tabla con la
       * posición que se ganó y sus partidos siguen contando para los demás.
       * Lo que deja de hacer es ocupar plaza.
       */
      const baja = el("button", "torneo-chip-baja", equipo.retirado ? "Vuelve" : "Retirar");
      baja.type = "button";
      baja.setAttribute(
        "aria-label",
        equipo.retirado
          ? `${equipo.nombre} vuelve a competir`
          : `Marcar que ${equipo.nombre} no compite la fase siguiente`
      );
      baja.addEventListener("click", () => cambiarRetirado(grupo, equipo));
      item.append(baja);

      const quitar = el("button", "torneo-chip-quitar", "×");
      quitar.type = "button";
      quitar.setAttribute("aria-label", `Sacar a ${equipo.nombre} de ${grupo.nombre}`);
      quitar.addEventListener("click", () => sacarEquipo(grupo, equipo));
      item.append(quitar);
      lista.append(item);
    });
    return lista;
  }

  /** Solo se ofrecen los que no están ya en algún grupo de esta misma fase. */
  function selectorDeEquipo(fase, grupo) {
    const idsEnLaFase = new Set(fase.grupos.flatMap((g) => g.equipos.map((e) => e.id)));
    const libres = (torneo.equipos || []).filter((equipo) => !idsEnLaFase.has(equipo.id));

    const caja = el("div", "torneo-anadir");
    if (libres.length === 0) {
      caja.append(el("p", "admin-hint", "Todos los equipos de la edición ya están repartidos en esta fase."));
      return caja;
    }

    const select = document.createElement("select");
    select.className = "admin-select";
    select.setAttribute("aria-label", `Añadir un equipo a ${grupo.nombre}`);
    const vacia = document.createElement("option");
    vacia.value = "";
    vacia.textContent = "Añadir equipo…";
    select.append(vacia);
    libres.forEach((equipo) => {
      const option = document.createElement("option");
      option.value = String(equipo.id);
      option.textContent = equipo.nombre;
      select.append(option);
    });

    select.addEventListener("change", async () => {
      if (!select.value) return;
      await escribir(() => apiJson(`/api/admin/torneo?accion=asignar&grupo=${grupo.id}`, "POST", {
        equipoId: Number(select.value)
      }));
    });

    caja.append(select);
    return caja;
  }

  function tablaClasificacion(grupo) {
    const tabla = el("table", "torneo-clasificacion");
    const thead = document.createElement("thead");
    const filaCabecera = document.createElement("tr");
    ["#", "Equipo", "PJ", "G", "P", "Sets", "Puntos", "Pts"].forEach((titulo) => {
      const th = document.createElement("th");
      th.scope = "col";
      th.textContent = titulo;
      filaCabecera.append(th);
    });
    thead.append(filaCabecera);

    const tbody = document.createElement("tbody");
    grupo.clasificacion.forEach((fila) => {
      const tr = document.createElement("tr");
      const celdas = [
        String(fila.posicion),
        fila.nombre,
        String(fila.jugados),
        String(fila.ganados),
        String(fila.perdidos),
        `${fila.setsAFavor}-${fila.setsEnContra}`,
        `${fila.puntosAFavor}-${fila.puntosEnContra}`,
        String(fila.puntos)
      ];
      celdas.forEach((valor, indice) => {
        const td = document.createElement("td");
        td.textContent = valor;
        if (indice !== 1) td.className = "is-num";
        tr.append(td);
      });
      // Pasar directo y pasar por repesca no son lo mismo: colores distintos.
      if (fila.clasifica) tr.classList.add(`is-${fila.clasifica}`);
      // Saber qué deshizo un empate evita la pregunta de por qué voy tercero.
      if (fila.desempatadoPor) {
        tr.title = `Desempatado por ${etiquetaCriterio(fila.desempatadoPor)}`;
        tr.classList.add("is-desempatado");
      }
      tbody.append(tr);
    });

    tabla.append(thead, tbody);
    const scroll = el("div", "torneo-clasificacion-scroll");
    scroll.append(tabla);
    return scroll;
  }

  const etiquetaCriterio = (clave) =>
    (torneo.criterios || []).find((c) => c.clave === clave)?.etiqueta || clave;

  // -------------------------------------------------------------- cuadro ---

  function cuadroDeFase(fase) {
    const caja = el("div", "torneo-cuadro-resumen");
    if (fase.partidos.length === 0) {
      caja.append(el("p", "admin-empty", "Todavía no hay cuadro. Genéralo y luego siembra los clasificados."));
      return caja;
    }

    const rondas = new Map();
    fase.partidos.forEach((partido) => {
      const clave = partido.rondaOrden ?? 0;
      if (!rondas.has(clave)) rondas.set(clave, []);
      rondas.get(clave).push(partido);
    });

    [...rondas.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([, partidos]) => {
        const bloque = el("div", "torneo-cuadro-ronda");
        bloque.append(el("h4", "", partidos[0].ronda));
        partidos
          .sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0))
          .forEach((partido) => {
            const linea = el("p", "torneo-cuadro-cruce");
            linea.textContent = `${partido.teams.A.name || "Por decidir"} — ${partido.teams.B.name || "Por decidir"}`;
            bloque.append(linea);
          });
        caja.append(bloque);
      });

    return caja;
  }

  // ------------------------------------------------------------ escritura ---

  /** Toda escritura recarga desde el servidor: es él quien tiene la verdad. */
  async function escribir(accion) {
    try {
      const datos = await accion();
      if (datos && Array.isArray(datos.fases)) torneo = datos;
      else await cargar();
      pintar();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  async function generarLiga(fase) {
    const ok = await confirmar({
      titulo: `Generar el calendario de «${fase.nombre}»`,
      texto: "Se crearán todos los cruces de todos los grupos de esta fase.",
      aviso: "Si ya había calendario en esta fase, se rehace: los partidos anteriores y sus resultados desaparecen.",
      accion: "Generar"
    });
    if (!ok) return;
    await escribir(() => apiJson(`/api/admin/torneo?accion=generar-liga&fase=${fase.id}`, "POST", {}));
  }

  async function generarCuadro(fase, tamano, tercerPuesto) {
    const ok = await confirmar({
      titulo: `Generar un cuadro de ${tamano} equipos`,
      texto: tercerPuesto
        ? "Se crearán los cruces vacíos, incluido el partido por el tercer puesto."
        : "Se crearán los cruces vacíos, sin partido por el tercer puesto.",
      aviso: "Si ya había cuadro en esta fase, se rehace: los cruces anteriores y sus resultados desaparecen.",
      accion: "Generar cuadro"
    });
    if (!ok) return;

    await escribir(() =>
      apiJson(`/api/admin/torneo?accion=generar-cuadro&fase=${fase.id}`, "POST", { tamano, tercerPuesto })
    );
  }

  async function sembrar(fase) {
    // Una fase sin cupo por grupo sigue valiendo si reparte plazas de repesca.
    const grupos = (torneo.fases || []).filter((f) => f.tipo === "grupos" && (f.clasifican > 0 || f.repesca > 0));
    if (grupos.length === 0) {
      setError("No hay ninguna fase de grupos que diga cuántos equipos clasifican.");
      return;
    }
    const origen = grupos[0];

    /*
     * El texto cuenta lo que va a pasar de verdad. Decir «los N primeros de cada
     * grupo» cuando hay cupos propios y repesca sería mentir justo en el diálogo
     * que pide confirmación.
     */
    const cupos = [...new Set(origen.grupos.map((g) => g.clasifican))];
    const directas = cupos.length === 1 ? `los ${cupos[0]} primeros de cada grupo` : "las plazas directas de cada grupo";
    const conRepesca = origen.repesca > 0 ? `, más ${origen.repesca} de repesca` : "";

    const ok = await confirmar({
      titulo: `Sembrar «${fase.nombre}»`,
      texto: `Se colocarán ${directas}${conRepesca} de «${origen.nombre}», cruzando primeros con últimos.`,
      aviso: "Sobrescribe los equipos que ya hubiera en la primera ronda del cuadro.",
      accion: "Sembrar"
    });
    if (!ok) return;

    await escribir(() =>
      apiJson(`/api/admin/torneo?accion=sembrar&fase=${fase.id}`, "POST", { desdeFase: origen.id })
    );
  }

  async function borrarFase(fase) {
    const ok = await confirmar({
      titulo: `Borrar la fase «${fase.nombre}»`,
      texto: "Desaparecerá con sus grupos y sus partidos.",
      aviso: "También se borran los resultados de esos partidos. No se puede deshacer.",
      accion: "Borrar fase"
    });
    if (!ok) return;
    await escribir(() => apiJson(`/api/admin/torneo?accion=fase&id=${fase.id}`, "DELETE"));
  }

  async function borrarGrupo(grupo) {
    const ok = await confirmar({
      titulo: `Borrar «${grupo.nombre}»`,
      texto: "Se borran también sus partidos.",
      accion: "Borrar grupo"
    });
    if (!ok) return;
    await escribir(() => apiJson(`/api/admin/torneo?accion=grupo&id=${grupo.id}`, "DELETE"));
  }

  async function sacarEquipo(grupo, equipo) {
    await escribir(() =>
      apiJson(`/api/admin/torneo?accion=asignar&grupo=${grupo.id}&equipo=${equipo.id}`, "DELETE")
    );
  }

  /*
   * Cambia quién puede competir la fase siguiente. Marcar pide confirmación
   * porque mueve las plazas de todo el grupo —y con ellas la repesca— en cuanto
   * se guarda; desmarcar no, porque devuelve las cosas a su sitio.
   */
  async function cambiarRetirado(grupo, equipo) {
    if (!equipo.retirado) {
      const ok = await confirmar({
        titulo: `${equipo.nombre} no compite`,
        texto: "Seguirá en la clasificación con su posición, pero su plaza pasará al siguiente del grupo.",
        accion: "Marcar la baja"
      });
      if (!ok) return;
    }
    await escribir(() =>
      apiJson(`/api/admin/torneo?accion=retirado&id=${grupo.id}`, "PATCH", {
        equipoId: equipo.id,
        retirado: !equipo.retirado
      })
    );
  }

  // ----------------------------------------------------- diálogo de fase ---

  const bannerFase = (mensaje) => {
    const nodo = dialogoFase.querySelector("[data-fase-banner]");
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
  };

  function errorFase(nombre, mensaje) {
    const nodo = dialogoFase.querySelector(`[data-fase-error="${nombre}"]`);
    if (!nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
  }

  const CAMPOS_ERROR_FASE = [
    "nombre",
    "clave",
    "tipo",
    "clasifican",
    "repesca",
    "reglas.sets",
    "reglas.puntosPorSet",
    "reglas.puntosSetDecisivo",
    "reglas.diferencia",
    "reglas.desempates"
  ];

  function pintarDesempates(seleccionados) {
    const caja = dialogoFase.querySelector("[data-fase-desempates]");
    clear(caja);
    // Primero los elegidos en su orden, luego el resto: la lista se lee como se aplica.
    const orden = [
      ...seleccionados,
      ...(torneo.criterios || []).map((c) => c.clave).filter((c) => !seleccionados.includes(c))
    ];

    orden.forEach((clave) => {
      const label = el("label", "torneo-desempate");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.dataset.desempate = clave;
      input.checked = seleccionados.includes(clave);
      label.append(input, el("span", "", etiquetaCriterio(clave)));
      caja.append(label);
    });
  }

  function sincronizarTipo() {
    const esGrupos = campoFase("tipo").value === "grupos";
    dialogoFase.querySelectorAll("[data-fase-solo-grupos]").forEach((nodo) => {
      nodo.hidden = !esGrupos;
    });
    const sets = Number(campoFase("sets").value) || 1;
    const pista = dialogoFase.querySelector("[data-fase-sets-pista]");
    if (pista) pista.textContent = sets === 1 ? "A un solo set." : `Al mejor de ${sets * 2 - 1}.`;
  }

  function abrirFase(fase) {
    faseEnEdicion = fase;
    bannerFase("");
    CAMPOS_ERROR_FASE.forEach((n) => errorFase(n, ""));

    const reglas = fase?.reglas || {
      partido: { sets: 2, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 },
      clasificacion: {
        puntosVictoria: 3,
        puntosDerrota: 0,
        puntosVictoriaAjustada: 2,
        puntosDerrotaAjustada: 1,
        desempates: ["puntos", "enfrentamiento_directo", "ratio_sets", "ratio_puntos"]
      }
    };

    dialogoFase.querySelector("[data-fase-titulo]").textContent = fase ? fase.nombre : "Nueva fase";
    campoFase("nombre").value = fase?.nombre || "";
    campoFase("clave").value = fase?.clave || "";
    campoFase("clave").disabled = Boolean(fase);
    campoFase("tipo").value = fase?.tipo || "grupos";
    campoFase("orden").value = String(fase?.orden ?? 0);
    campoFase("clasifican").value = String(fase?.clasifican ?? 2);
    campoFase("repesca").value = String(fase?.repesca ?? 0);

    Object.entries(reglas.partido).forEach(([clave, valor]) => {
      const campo = campoFase(clave);
      if (campo) campo.value = String(valor);
    });
    Object.entries(reglas.clasificacion).forEach(([clave, valor]) => {
      const campo = campoFase(clave);
      if (campo && !Array.isArray(valor)) campo.value = String(valor);
    });

    pintarDesempates(reglas.clasificacion.desempates || []);
    sincronizarTipo();
    dialogoFase.showModal();
  }

  function leerFase() {
    const numero = (nombre) => Number(campoFase(nombre).value);
    return {
      clave: limpiar(campoFase("clave").value).toLowerCase(),
      nombre: limpiar(campoFase("nombre").value),
      tipo: campoFase("tipo").value,
      orden: numero("orden") || 0,
      clasifican: numero("clasifican") || 0,
      repesca: numero("repesca") || 0,
      reglas: {
        partido: {
          sets: numero("sets"),
          puntosPorSet: numero("puntosPorSet"),
          puntosSetDecisivo: numero("puntosSetDecisivo"),
          diferencia: numero("diferencia")
        },
        clasificacion: {
          puntosVictoria: numero("puntosVictoria"),
          puntosDerrota: numero("puntosDerrota"),
          puntosVictoriaAjustada: numero("puntosVictoriaAjustada"),
          puntosDerrotaAjustada: numero("puntosDerrotaAjustada"),
          desempates: [...dialogoFase.querySelectorAll("[data-desempate]")]
            .filter((input) => input.checked)
            .map((input) => input.dataset.desempate)
        }
      }
    };
  }

  document.querySelector("[data-fase-nueva]")?.addEventListener("click", () => abrirFase(null));
  dialogoFase?.querySelector("[data-fase-field='tipo']")?.addEventListener("change", sincronizarTipo);
  dialogoFase?.querySelector("[data-fase-field='sets']")?.addEventListener("input", sincronizarTipo);

  dialogoFase?.querySelector("[data-fase-guardar]")?.addEventListener("click", async () => {
    bannerFase("");
    CAMPOS_ERROR_FASE.forEach((n) => errorFase(n, ""));

    const datos = leerFase();
    const guardar = dialogoFase.querySelector("[data-fase-guardar]");
    guardar.disabled = true;
    try {
      const ruta = faseEnEdicion
        ? `/api/admin/torneo?accion=fase&id=${faseEnEdicion.id}`
        : "/api/admin/torneo?accion=fase";
      const datosNuevos = await apiJson(ruta, faseEnEdicion ? "PATCH" : "POST", datos);
      if (Array.isArray(datosNuevos.fases)) torneo = datosNuevos;
      dialogoFase.close();
      pintar();
    } catch (err) {
      Object.entries(err.campos || {}).forEach(([n, m]) => errorFase(n, m));
      bannerFase(err.message);
    } finally {
      guardar.disabled = false;
    }
  });

  dialogoFase?.querySelector("[data-fase-cerrar]")?.addEventListener("click", () => dialogoFase.close());
  dialogoFase?.querySelector("[data-fase-cancelar]")?.addEventListener("click", () => dialogoFase.close());
  dialogoFase?.addEventListener("close", () => {
    faseEnEdicion = null;
  });

  // ---------------------------------------------------- diálogo de grupo ---

  const bannerGrupo = (mensaje) => {
    const nodo = dialogoGrupo.querySelector("[data-grupo-banner]");
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
  };

  function sincronizarReglasGrupo() {
    dialogoGrupo.querySelector("[data-grupo-reglas]").hidden = !campoGrupo("propias").checked;
  }

  function abrirGrupo(fase, grupo) {
    faseDelGrupo = fase;
    grupoEnEdicion = grupo;
    bannerGrupo("");

    dialogoGrupo.querySelector("[data-grupo-titulo]").textContent = grupo ? grupo.nombre : "Nuevo grupo";
    dialogoGrupo.querySelector("[data-grupo-sub]").textContent = `En «${fase.nombre}»`;

    campoGrupo("nombre").value = grupo?.nombre || "";
    campoGrupo("orden").value = String(grupo?.orden ?? 0);
    campoGrupo("propias").checked = Boolean(grupo?.reglasPropias);
    // Vacío significa «hereda de la fase», que no es lo mismo que 0.
    campoGrupo("clasifican").value = grupo?.clasificanPropio == null ? "" : String(grupo.clasificanPropio);
    campoGrupo("enRepesca").checked = grupo ? grupo.enRepesca !== false : true;

    const reglas = (grupo?.reglasPropias || grupo?.reglas || fase.reglas).partido;
    Object.entries(reglas).forEach(([clave, valor]) => {
      const campo = campoGrupo(clave);
      if (campo) campo.value = String(valor);
    });

    sincronizarReglasGrupo();
    dialogoGrupo.showModal();
  }

  dialogoGrupo?.querySelector("[data-grupo-field='propias']")?.addEventListener("change", sincronizarReglasGrupo);

  dialogoGrupo?.querySelector("[data-grupo-guardar]")?.addEventListener("click", async () => {
    bannerGrupo("");
    const numero = (nombre) => Number(campoGrupo(nombre).value);

    const datos = {
      nombre: limpiar(campoGrupo("nombre").value),
      orden: numero("orden") || 0,
      // Cadena vacía = hereda; el endpoint distingue null de 0.
      clasifican: campoGrupo("clasifican").value.trim() === "" ? null : numero("clasifican"),
      enRepesca: campoGrupo("enRepesca").checked,
      // null significa "hereda de la fase", que es distinto de "las mismas por casualidad".
      reglas: campoGrupo("propias").checked
        ? {
            partido: {
              sets: numero("sets"),
              puntosPorSet: numero("puntosPorSet"),
              puntosSetDecisivo: numero("puntosSetDecisivo"),
              diferencia: numero("diferencia")
            }
          }
        : null
    };

    const guardar = dialogoGrupo.querySelector("[data-grupo-guardar]");
    guardar.disabled = true;
    try {
      const ruta = grupoEnEdicion
        ? `/api/admin/torneo?accion=grupo&id=${grupoEnEdicion.id}`
        : `/api/admin/torneo?accion=grupo&fase=${faseDelGrupo.id}`;
      const datosNuevos = await apiJson(ruta, grupoEnEdicion ? "PATCH" : "POST", datos);
      if (Array.isArray(datosNuevos.fases)) torneo = datosNuevos;
      dialogoGrupo.close();
      pintar();
    } catch (err) {
      const nodo = dialogoGrupo.querySelector('[data-grupo-error="nombre"]');
      if (nodo && err.campos?.nombre) {
        nodo.textContent = err.campos.nombre;
        nodo.hidden = false;
      }
      bannerGrupo(err.message);
    } finally {
      guardar.disabled = false;
    }
  });

  dialogoGrupo?.querySelector("[data-grupo-cerrar]")?.addEventListener("click", () => dialogoGrupo.close());
  dialogoGrupo?.querySelector("[data-grupo-cancelar]")?.addEventListener("click", () => dialogoGrupo.close());
  dialogoGrupo?.addEventListener("close", () => {
    grupoEnEdicion = null;
    faseDelGrupo = null;
  });

  // ------------------------------------------------------------ utilidad ---

  function celdaAcciones(...hijos) {
    const caja = el("div", "admin-row-actions");
    hijos.filter(Boolean).forEach((hijo) => caja.appendChild(hijo));
    return caja;
  }
})();
