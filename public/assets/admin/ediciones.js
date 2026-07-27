/*
 * /admin/ediciones/ — ciclo de vida de las ediciones (crear, marcar actual,
 * cambiar estado, borrar) y puesto final de cada equipo, que es lo que
 * alimenta el palmarés de la ficha pública.
 *
 * El puesto se guarda contra /api/admin/equipos?accion=posicion porque
 * posicion_final es una columna de `equipos`, aunque se edite desde aquí.
 */
(() => {
  const raiz = document.querySelector("[data-admin-ediciones]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, apiJson, onReady, setError, clear, confirmar } = window.CopaAdmin;

  const listaEl = raiz.querySelector("[data-ediciones-list]");
  const form = raiz.querySelector("[data-edicion-form]");
  const submitBtn = raiz.querySelector("[data-edicion-submit]");
  const resultadosLabel = raiz.querySelector("[data-resultados-edicion]");
  const resultadosEl = raiz.querySelector("[data-resultados-list]");
  const contador = document.querySelector("[data-admin-contador]");

  const ESTADOS = [
    ["proxima", "Próxima"],
    ["en_juego", "En juego"],
    ["finalizada", "Finalizada"]
  ];
  const ESTADO_LABEL = new Map(ESTADOS);
  const MEDALLAS = { 1: "oro", 2: "plata", 3: "bronce" };
  const ordinal = (n) => `${n}º`;

  let ediciones = [];
  let equipos = [];
  let seleccionada = null;

  onReady(async () => {
    aplicar(await api("/api/admin/ediciones"));
  });

  function aplicar(datos) {
    ediciones = Array.isArray(datos.ediciones) ? datos.ediciones : [];
    equipos = Array.isArray(datos.equipos) ? datos.equipos : [];

    if (!ediciones.some((e) => e.id === seleccionada)) {
      const actual = ediciones.find((e) => e.esActual);
      seleccionada = actual ? actual.id : ediciones.length ? ediciones[0].id : null;
    }
    pintarEdiciones();
    pintarResultados();

    if (contador) {
      contador.textContent = ediciones.length
        ? `${ediciones.length} ${ediciones.length === 1 ? "edición" : "ediciones"}`
        : "Todavía no hay ediciones";
    }
  }

  function pintarEdiciones() {
    clear(listaEl);
    ediciones.forEach((ed) => {
      const item = document.createElement("div");
      item.className = "edicion-item";
      if (ed.id === seleccionada) item.classList.add("is-selected");
      if (ed.esActual) item.classList.add("is-actual");

      const head = document.createElement("button");
      head.type = "button";
      head.className = "edicion-head";
      head.setAttribute("aria-pressed", ed.id === seleccionada ? "true" : "false");
      head.addEventListener("click", () => {
        seleccionada = ed.id;
        pintarEdiciones();
        pintarResultados();
      });

      const anio = document.createElement("span");
      anio.className = "edicion-anio";
      anio.textContent = ed.anio;

      const meta = document.createElement("span");
      meta.className = "edicion-meta";
      const nombre = document.createElement("strong");
      nombre.className = "edicion-nombre";
      nombre.textContent = ed.nombre;
      const sub = document.createElement("span");
      sub.className = "edicion-sub";
      sub.textContent = `${ed.equipos} ${ed.equipos === 1 ? "equipo" : "equipos"}`;
      meta.append(nombre, sub);

      const chips = document.createElement("span");
      chips.className = "edicion-chips";
      const estado = document.createElement("span");
      estado.className = `edicion-estado edicion-estado--${ed.estado}`;
      estado.textContent = ESTADO_LABEL.get(ed.estado) || ed.estado;
      chips.append(estado);
      if (ed.esActual) {
        const actual = document.createElement("span");
        actual.className = "edicion-actual-chip";
        actual.textContent = "Actual";
        chips.append(actual);
      }

      head.append(anio, meta, chips);
      item.append(head);

      const acciones = document.createElement("div");
      acciones.className = "edicion-acciones";

      const estadoSelect = document.createElement("select");
      estadoSelect.className = "admin-select admin-btn--sm";
      estadoSelect.style.width = "auto";
      estadoSelect.setAttribute("aria-label", `Estado de ${ed.nombre}`);
      ESTADOS.forEach(([valor, texto]) => {
        const opt = document.createElement("option");
        opt.value = valor;
        opt.textContent = texto;
        if (valor === ed.estado) opt.selected = true;
        estadoSelect.append(opt);
      });
      estadoSelect.addEventListener("change", () => cambiarEstado(ed, estadoSelect));
      acciones.append(estadoSelect);

      if (!ed.esActual) {
        const actualBtn = document.createElement("button");
        actualBtn.type = "button";
        actualBtn.className = "admin-btn admin-btn--sm";
        actualBtn.textContent = "Marcar actual";
        actualBtn.addEventListener("click", () => marcarActual(ed));
        acciones.append(actualBtn);
      }

      if (!ed.esActual && ed.equipos === 0) {
        const borrar = document.createElement("button");
        borrar.type = "button";
        borrar.className = "admin-btn admin-btn--sm admin-btn--danger edicion-borrar";
        borrar.textContent = "Borrar";
        borrar.addEventListener("click", () => borrarEdicion(ed));
        acciones.append(borrar);
      }

      item.append(acciones);
      listaEl.append(item);
    });
  }

  function pintarResultados() {
    clear(resultadosEl);
    const edicion = ediciones.find((e) => e.id === seleccionada) || null;
    resultadosLabel.textContent = edicion ? edicion.nombre : "edición";

    const deLaEdicion = equipos
      .filter((e) => e.edicionId === seleccionada)
      .sort((a, b) => {
        const pa = a.posicionFinal == null ? Infinity : a.posicionFinal;
        const pb = b.posicionFinal == null ? Infinity : b.posicionFinal;
        if (pa !== pb) return pa - pb;
        return a.nombre.localeCompare(b.nombre, "es");
      });

    if (deLaEdicion.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "ediciones-hint";
      vacio.textContent = edicion
        ? "Esta edición todavía no tiene equipos inscritos."
        : "Elige una edición para asignar puestos.";
      resultadosEl.append(vacio);
      return;
    }

    deLaEdicion.forEach((equipo) => resultadosEl.append(filaResultado(equipo)));
  }

  function filaResultado(equipo) {
    const fila = document.createElement("div");
    fila.className = "resultado-item";
    const medalla = equipo.posicionFinal != null ? MEDALLAS[equipo.posicionFinal] : null;
    if (medalla) fila.classList.add(`resultado-item--${medalla}`);

    const rango = document.createElement("span");
    rango.className = "resultado-rango";
    rango.textContent = equipo.posicionFinal != null ? ordinal(equipo.posicionFinal) : "—";

    const nombre = document.createElement("span");
    nombre.className = "resultado-nombre";
    nombre.textContent = equipo.nombre;

    const control = document.createElement("label");
    control.className = "resultado-control";
    const etiqueta = document.createElement("span");
    etiqueta.className = "resultado-control-label";
    etiqueta.textContent = "Puesto";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "99";
    input.step = "1";
    input.inputMode = "numeric";
    input.className = "resultado-input";
    input.value = equipo.posicionFinal != null ? String(equipo.posicionFinal) : "";
    input.setAttribute("aria-label", `Puesto de ${equipo.nombre}`);
    input.addEventListener("change", () => guardarPuesto(equipo, input));
    control.append(etiqueta, input);

    fila.append(rango, nombre, control);
    return fila;
  }

  async function guardarPuesto(equipo, input) {
    const bruto = input.value.trim();
    let valor = null;
    if (bruto !== "") {
      const n = Number(bruto);
      if (!Number.isInteger(n) || n < 1 || n > 99) {
        setError(`El puesto de ${equipo.nombre} debe estar entre 1 y 99.`);
        input.value = equipo.posicionFinal != null ? String(equipo.posicionFinal) : "";
        return;
      }
      valor = n;
    }

    input.disabled = true;
    try {
      const datos = await apiJson(
        `/api/admin/equipos?accion=posicion&id=${encodeURIComponent(equipo.id)}`,
        "PATCH",
        { posicionFinal: valor }
      );
      equipo.posicionFinal = datos.posicionFinal ?? null;
      setError("");
      pintarResultados();
    } catch (err) {
      setError(err.message);
      input.value = equipo.posicionFinal != null ? String(equipo.posicionFinal) : "";
    } finally {
      input.disabled = false;
    }
  }

  async function cambiarEstado(ed, select) {
    const estado = select.value;
    if (estado === ed.estado) return;
    try {
      aplicar(await apiJson(`/api/admin/ediciones?id=${encodeURIComponent(ed.id)}`, "PATCH", { estado }));
      setError("");
    } catch (err) {
      select.value = ed.estado;
      setError(err.message);
    }
  }

  async function marcarActual(ed) {
    try {
      aplicar(await apiJson(`/api/admin/ediciones?id=${encodeURIComponent(ed.id)}`, "PATCH", { esActual: true }));
      setError("");
      // La edición actual condiciona qué equipo ve cada usuario en /mi-equipo/.
      await window.CopaAuth?.refresh?.();
    } catch (err) {
      setError(err.message);
    }
  }

  async function borrarEdicion(ed) {
    const ok = await confirmar({
      titulo: "Borrar edición",
      texto: `Se va a borrar «${ed.nombre}» (${ed.anio}).`,
      aviso: "No se puede deshacer.",
      accion: "Borrar edición"
    });
    if (!ok) return;

    try {
      await api(`/api/admin/ediciones?id=${encodeURIComponent(ed.id)}`, { method: "DELETE" });
      aplicar(await api("/api/admin/ediciones"));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }

  function setErrorCampo(campo, mensaje) {
    const nodo = form.querySelector(`[data-edicion-error="${campo}"]`);
    if (!nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
    const input = form.querySelector(`[data-edicion-field="${campo}"]`);
    if (input) {
      input.setAttribute("aria-invalid", mensaje ? "true" : "false");
      input.closest(".admin-field")?.classList.toggle("has-error", Boolean(mensaje));
    }
  }

  form?.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    form.querySelectorAll("[data-edicion-error]").forEach((n) => {
      n.textContent = "";
      n.hidden = true;
    });
    setError("");

    const anio = form.querySelector('[data-edicion-field="anio"]').value.trim();
    const nombre = form.querySelector('[data-edicion-field="nombre"]').value.trim();

    submitBtn.disabled = true;
    try {
      aplicar(await apiJson("/api/admin/ediciones", "POST", { anio: anio === "" ? null : Number(anio), nombre }));
      form.reset();
    } catch (err) {
      if (err.campos) Object.entries(err.campos).forEach(([campo, mensaje]) => setErrorCampo(campo, mensaje));
      else setError(err.message);
    } finally {
      submitBtn.disabled = false;
    }
  });
})();
