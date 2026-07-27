// Panel de "Ediciones y resultados" del admin (Fase 3): gestiona el ciclo de
// vida de las ediciones (crear, marcar actual, cambiar estado, borrar) y el
// puesto final de cada equipo, que es lo que alimenta el palmarés de la ficha.
// Se apoya en el mismo evento copa:auth que el resto del panel; su fetch es
// independiente de admin.js para no entrelazarse con el editor de equipos.
(() => {
  const root = document.querySelector("[data-admin-ediciones]");
  if (!root) return;

  const statusEl = root.querySelector("[data-ediciones-status]");
  const errorEl = root.querySelector("[data-ediciones-error]");
  const listEl = root.querySelector("[data-ediciones-list]");
  const form = root.querySelector("[data-edicion-form]");
  const submitBtn = root.querySelector("[data-edicion-submit]");
  const resultadosLabel = root.querySelector("[data-resultados-edicion]");
  const resultadosEl = root.querySelector("[data-resultados-list]");

  const ESTADOS = [
    ["proxima", "Próxima"],
    ["en_juego", "En juego"],
    ["finalizada", "Finalizada"]
  ];
  const ESTADO_LABEL = new Map(ESTADOS);
  const MEDALLAS = { 1: "oro", 2: "plata", 3: "bronce" };
  const ORDINAL = (n) => `${n}º`;

  let ediciones = [];
  let equipos = [];
  let selectedEdicionId = null;

  function setError(message) {
    errorEl.textContent = message || "";
    errorEl.hidden = !message;
  }

  function setFieldError(campo, message) {
    const node = form.querySelector(`[data-edicion-error="${campo}"]`);
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
    const input = form.querySelector(`[data-edicion-field="${campo}"]`);
    if (input) input.setAttribute("aria-invalid", message ? "true" : "false");
  }

  function clearFieldErrors() {
    form.querySelectorAll("[data-edicion-error]").forEach((n) => {
      n.textContent = "";
      n.hidden = true;
    });
  }

  function clear(node) {
    node.textContent = "";
  }

  async function api(url, options) {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json", ...(options && options.headers) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || "No se ha podido completar la acción.");
      err.campos = data.campos || null;
      err.status = response.status;
      throw err;
    }
    return data;
  }

  async function load() {
    try {
      const data = await api("/api/admin?view=ediciones");
      aplicar(data);
      root.hidden = false;
      setError("");
    } catch (err) {
      // Si la BD aún no tiene la migración 0006, el panel simplemente no aparece.
      root.hidden = true;
      statusEl.textContent = "";
      console.error("No se pudieron cargar ediciones:", err);
    }
  }

  function aplicar(data) {
    ediciones = Array.isArray(data.ediciones) ? data.ediciones : [];
    equipos = Array.isArray(data.equipos) ? data.equipos : [];
    const sigueValida = ediciones.some((e) => e.id === selectedEdicionId);
    if (!sigueValida) {
      const actual = ediciones.find((e) => e.esActual);
      selectedEdicionId = actual ? actual.id : ediciones.length ? ediciones[0].id : null;
    }
    renderEdiciones();
    renderResultados();
    statusEl.textContent = ediciones.length
      ? `${ediciones.length} ${ediciones.length === 1 ? "edición" : "ediciones"}.`
      : "Todavía no hay ediciones.";
  }

  function renderEdiciones() {
    clear(listEl);
    ediciones.forEach((ed) => {
      const item = document.createElement("div");
      item.className = "edicion-item";
      if (ed.id === selectedEdicionId) item.classList.add("is-selected");
      if (ed.esActual) item.classList.add("is-actual");

      const head = document.createElement("button");
      head.type = "button";
      head.className = "edicion-head";
      head.setAttribute("aria-pressed", ed.id === selectedEdicionId ? "true" : "false");
      head.addEventListener("click", () => {
        selectedEdicionId = ed.id;
        renderEdiciones();
        renderResultados();
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
      estadoSelect.className = "edicion-estado-select";
      estadoSelect.setAttribute("aria-label", `Estado de ${ed.nombre}`);
      ESTADOS.forEach(([value, label]) => {
        const opt = document.createElement("option");
        opt.value = value;
        opt.textContent = label;
        if (value === ed.estado) opt.selected = true;
        estadoSelect.append(opt);
      });
      estadoSelect.addEventListener("change", () => cambiarEstado(ed, estadoSelect));
      acciones.append(estadoSelect);

      if (!ed.esActual) {
        const actualBtn = document.createElement("button");
        actualBtn.type = "button";
        actualBtn.className = "add-player edicion-actual-btn";
        actualBtn.textContent = "Marcar actual";
        actualBtn.addEventListener("click", () => marcarActual(ed));
        acciones.append(actualBtn);
      }

      if (!ed.esActual && ed.equipos === 0) {
        const borrar = document.createElement("button");
        borrar.type = "button";
        borrar.className = "admin-danger edicion-borrar";
        borrar.textContent = "Borrar";
        borrar.addEventListener("click", () => borrarEdicion(ed));
        acciones.append(borrar);
      }

      item.append(acciones);
      listEl.append(item);
    });
  }

  function renderResultados() {
    clear(resultadosEl);
    const edicion = ediciones.find((e) => e.id === selectedEdicionId) || null;
    resultadosLabel.textContent = edicion ? `${edicion.nombre}` : "edición";

    const equiposEdicion = equipos
      .filter((e) => e.edicionId === selectedEdicionId)
      .sort((a, b) => {
        const pa = a.posicionFinal == null ? Infinity : a.posicionFinal;
        const pb = b.posicionFinal == null ? Infinity : b.posicionFinal;
        if (pa !== pb) return pa - pb;
        return a.nombre.localeCompare(b.nombre, "es");
      });

    if (equiposEdicion.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "ediciones-hint";
      vacio.textContent = edicion
        ? "Esta edición todavía no tiene equipos inscritos."
        : "Elige una edición para asignar puestos.";
      resultadosEl.append(vacio);
      return;
    }

    equiposEdicion.forEach((equipo) => {
      resultadosEl.append(filaResultado(equipo));
    });
  }

  function filaResultado(equipo) {
    const fila = document.createElement("div");
    fila.className = "resultado-item";
    const medalla = equipo.posicionFinal != null ? MEDALLAS[equipo.posicionFinal] : null;
    if (medalla) fila.classList.add(`resultado-item--${medalla}`);

    const rango = document.createElement("span");
    rango.className = "resultado-rango";
    rango.textContent = equipo.posicionFinal != null ? ORDINAL(equipo.posicionFinal) : "—";

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
    const raw = input.value.trim();
    let valor = null;
    if (raw !== "") {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 99) {
        setError(`El puesto de ${equipo.nombre} debe estar entre 1 y 99.`);
        input.value = equipo.posicionFinal != null ? String(equipo.posicionFinal) : "";
        return;
      }
      valor = n;
    }
    input.disabled = true;
    try {
      const data = await api(`/api/admin?type=posicion&id=${encodeURIComponent(equipo.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posicionFinal: valor })
      });
      equipo.posicionFinal = data.posicionFinal ?? null;
      setError("");
      renderResultados();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido guardar el puesto.");
      input.value = equipo.posicionFinal != null ? String(equipo.posicionFinal) : "";
    } finally {
      input.disabled = false;
    }
  }

  async function cambiarEstado(ed, select) {
    const estado = select.value;
    if (estado === ed.estado) return;
    try {
      const data = await api(`/api/admin?type=edicion&id=${encodeURIComponent(ed.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ estado })
      });
      aplicar(data);
      setError("");
    } catch (err) {
      select.value = ed.estado;
      setError(err instanceof Error ? err.message : "No se ha podido cambiar el estado.");
    }
  }

  async function marcarActual(ed) {
    try {
      const data = await api(`/api/admin?type=edicion&id=${encodeURIComponent(ed.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ esActual: true })
      });
      aplicar(data);
      setError("");
      await window.CopaAuth?.refresh?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido marcar la edición como actual.");
    }
  }

  async function borrarEdicion(ed) {
    if (!window.confirm(`¿Borrar la edición "${ed.nombre}"? Esta acción no se puede deshacer.`)) return;
    try {
      await api(`/api/admin?type=edicion&id=${encodeURIComponent(ed.id)}`, { method: "DELETE" });
      await load();
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido borrar la edición.");
    }
  }

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    clearFieldErrors();
    setError("");
    const anio = form.querySelector('[data-edicion-field="anio"]').value.trim();
    const nombre = form.querySelector('[data-edicion-field="nombre"]').value.trim();
    submitBtn.disabled = true;
    try {
      const data = await api("/api/admin?type=edicion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anio: anio === "" ? null : Number(anio), nombre })
      });
      aplicar(data);
      form.reset();
      setError("");
    } catch (err) {
      if (err && err.campos) {
        Object.entries(err.campos).forEach(([campo, mensaje]) => setFieldError(campo, mensaje));
      } else {
        setError(err instanceof Error ? err.message : "No se ha podido crear la edición.");
      }
    } finally {
      submitBtn.disabled = false;
    }
  });

  window.addEventListener("copa:auth", (event) => {
    const detail = event.detail || {};
    if (detail.loading) return;
    if (!detail.user) {
      root.hidden = true;
      return;
    }
    load();
  });

  if (window.CopaAuth?.state && !window.CopaAuth.state.loading && window.CopaAuth.state.user) {
    load();
  }
})();
