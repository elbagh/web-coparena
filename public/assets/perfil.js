(() => {
  const shell = document.querySelector("[data-perfil]");
  if (!shell) return;

  const cromoWrap = shell.querySelector("[data-cromo]");
  const tabsRoot = shell.querySelector("[data-tabs]");
  const historialRoot = shell.querySelector("[data-historial]");
  const fichaForm = shell.querySelector("[data-ficha-form]");
  const fichaBanner = fichaForm?.querySelector("[data-ficha-banner]");
  const avatarInput = fichaForm?.querySelector("[data-ficha-avatar]");
  const avatarDelete = fichaForm?.querySelector("[data-ficha-avatar-delete]");
  const fichaSave = fichaForm?.querySelector("[data-ficha-save]");

  // Debe coincidir con functions/_lib/perfil.ts (ATRIBUTOS) y con
  // public/assets/players-list.js. Aquí solo se leen: los pone la organización.
  const ATRIBUTOS = [
    { key: "saque", label: "Saque" },
    { key: "remate", label: "Remate" },
    { key: "bloqueo", label: "Bloqueo" },
    { key: "defensa", label: "Defensa" },
    { key: "recepcion", label: "Recepción" },
    { key: "colocacion", label: "Colocación" }
  ];

  let perfil = null;
  let cargado = false;

  const { el, iniciales } = window.CopaCromo;

  // ---------------------------------------------------------------- tabs ----
  function initTabs() {
    if (!tabsRoot) return;
    const tabs = Array.from(tabsRoot.querySelectorAll('[role="tab"]'));
    const panels = Array.from(tabsRoot.querySelectorAll('[role="tabpanel"]'));

    function activate(name, focus) {
      tabs.forEach((tab) => {
        const on = tab.dataset.tab === name;
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
        if (on && focus) tab.focus();
      });
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.panel !== name;
      });
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener("click", () => activate(tab.dataset.tab));
      tab.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
        event.preventDefault();
        const dir = event.key === "ArrowRight" ? 1 : -1;
        const next = tabs[(index + dir + tabs.length) % tabs.length];
        activate(next.dataset.tab, true);
      });
    });
  }

  // --------------------------------------------------------------- cromo ----
  function renderCromo() {
    cromoWrap.textContent = "";
    if (!perfil) return;

    const p = perfil.perfil || {};
    const jugador = perfil.jugador;
    const nombre = jugador
      ? `${jugador.nombre} ${jugador.apellidos}`.trim()
      : perfil.user?.nombre || perfil.user?.email || "Jugador";
    const ed = perfil.edicionActual;
    const teamActual = (perfil.historial || []).find((h) => h.esActual);

    const pal = perfil.palmares || {};
    const sinPodios = !pal.mejorPuesto && !(pal.podios?.oro || pal.podios?.plata || pal.podios?.bronce);
    const valores = p.atributos || {};
    const conAtributos = ATRIBUTOS.filter((a) => valores[a.key] != null);

    cromoWrap.appendChild(
      window.CopaCromo.crear({
        edicion: ed ? `${ed.nombre} · ${estadoTexto(ed.estado)}` : "La Copa Arena",
        dorsal: p.dorsal,
        nombre,
        apodo: p.apodo,
        posicion: p.posicion,
        lema: p.lema,
        chips: [p.posicion, p.mano, teamActual?.equipoNombre],
        // El parámetro rompe la caché tras cambiar el avatar.
        fotoUrl: p.tieneAvatar ? `/api/avatar?t=${Date.now()}` : null,
        iniciales: iniciales(jugador?.nombre, jugador?.apellidos, perfil.user?.email),
        bloques: [
          {
            label: "Palmarés",
            tiles: [
              { valor: String(pal.edicionesJugadas ?? 0), etiqueta: "Ediciones" },
              { valor: String(pal.podios?.oro ?? 0), etiqueta: "Oro", variante: "oro" },
              { valor: String(pal.podios?.plata ?? 0), etiqueta: "Plata", variante: "plata" },
              { valor: String(pal.podios?.bronce ?? 0), etiqueta: "Bronce", variante: "bronce" },
              { valor: pal.mejorPuesto != null ? `${pal.mejorPuesto}º` : "—", etiqueta: "Mejor puesto" }
            ],
            texto: sinPodios ? "Aún sin podios: la Copa 2026 está en juego." : null
          },
          {
            label: "Tu juego",
            atributos: conAtributos.map((a) => ({ label: a.label, valor: valores[a.key] })),
            texto: conAtributos.length ? null : "La organización aún no ha puntuado tu juego."
          }
        ]
      })
    );
  }

  function estadoTexto(estado) {
    if (estado === "en_juego") return "En juego";
    if (estado === "finalizada") return "Finalizada";
    if (estado === "proxima") return "Próxima";
    return "";
  }

  // ----------------------------------------------------------- historial ----
  function renderHistorial() {
    if (!historialRoot) return;
    historialRoot.textContent = "";
    const historial = perfil?.historial || [];

    if (historial.length === 0) {
      historialRoot.appendChild(el("p", "eyebrow", "Historial"));
      historialRoot.appendChild(el("h2", null, "Tu historia empieza aquí"));
      historialRoot.appendChild(
        el("p", "teams-status", "Cuando juegues tu primera edición, tus equipos y resultados aparecerán en esta línea.")
      );
      return;
    }

    historialRoot.appendChild(el("p", "eyebrow", "Historial"));
    historialRoot.appendChild(el("h2", null, "Tus ediciones"));
    const lista = el("div", "historial-list");
    historial.forEach((h) => lista.appendChild(historialItem(h)));
    historialRoot.appendChild(lista);
  }

  function historialItem(h) {
    const item = el("article", "historial-item" + (h.esActual ? " historial-item--actual" : ""));

    const head = el("div", "historial-head");
    head.appendChild(el("span", "historial-anio", h.anio != null ? String(h.anio) : "—"));
    const titulos = el("div", "historial-titulos");
    titulos.appendChild(el("h3", null, h.equipoNombre));
    const sub = el("p", "historial-sub");
    sub.textContent = h.esActual ? "Edición en juego" : h.nombreEdicion || "";
    titulos.appendChild(sub);
    head.appendChild(titulos);
    head.appendChild(medalla(h.posicionFinal, h.esActual));
    item.appendChild(head);

    const resumen = resumenEstadisticas(h.estadisticas);
    if (resumen) item.appendChild(el("p", "historial-stats", resumen));

    const companeros = h.companeros || [];
    if (companeros.length) {
      const linea = companeros.map((c) => `${c.nombre} ${c.apellido}`.trim()).join(" · ");
      item.appendChild(el("p", "historial-companeros", `Con ${linea}`));
    }
    return item;
  }

  /** Línea corta con lo que haya anotado; vacía si la edición aún no tiene datos. */
  function resumenEstadisticas(stats) {
    if (!stats) return "";
    const partes = [
      [stats.puntos, "puntos"],
      [stats.remates, "remates"],
      [stats.bloqueos, "bloqueos"],
      [stats.aces, "aces"]
    ]
      .filter(([valor]) => valor > 0)
      .map(([valor, etiqueta]) => `${valor} ${etiqueta}`);
    return partes.join(" · ");
  }

  function medalla(posicion, esActual) {
    if (posicion == null) {
      return el("span", "historial-puesto historial-puesto--pendiente", esActual ? "En juego" : "Sin puesto");
    }
    const variante = posicion === 1 ? "oro" : posicion === 2 ? "plata" : posicion === 3 ? "bronce" : "otro";
    return el("span", "historial-puesto historial-puesto--" + variante, `${posicion}º`);
  }

  // -------------------------------------------------------- editar ficha ----
  function fillFichaForm() {
    if (!fichaForm) return;
    const p = perfil?.perfil || {};
    const set = (name, value) => {
      const node = fichaForm.querySelector(`[data-ficha-field="${name}"]`);
      if (node) node.value = value == null ? "" : String(value);
    };
    set("apodo", p.apodo);
    set("dorsal", p.dorsal);
    set("posicion", p.posicion);
    set("mano", p.mano);
    set("lema", p.lema);
    if (avatarDelete) avatarDelete.hidden = !p.tieneAvatar;
  }

  function setFichaError(name, message) {
    const node = fichaForm?.querySelector(`[data-ficha-error="${name}"]`);
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
  }

  function setFichaBanner(message, kind = "error") {
    if (!fichaBanner) return;
    fichaBanner.textContent = message || "";
    fichaBanner.dataset.kind = kind;
    fichaBanner.hidden = !message;
    if (message) fichaBanner.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function clearFichaErrors() {
    ["apodo", "dorsal", "lema", "avatar"].forEach((name) => setFichaError(name, ""));
    setFichaBanner("");
  }

  function fichaPayload() {
    const value = (name) => fichaForm.querySelector(`[data-ficha-field="${name}"]`)?.value ?? "";
    return {
      apodo: value("apodo").trim(),
      dorsal: value("dorsal").trim(),
      posicion: value("posicion"),
      mano: value("mano"),
      lema: value("lema").trim()
    };
  }

  async function guardarFicha(event) {
    event.preventDefault();
    clearFichaErrors();
    const original = fichaSave?.textContent;
    if (fichaSave) {
      fichaSave.disabled = true;
      fichaSave.textContent = "Guardando...";
    }
    try {
      const response = await fetch("/api/perfil", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify(fichaPayload())
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        Object.entries(data.campos || {}).forEach(([name, message]) => setFichaError(name, message));
        throw new Error(data.error || "No se ha podido guardar la ficha.");
      }
      perfil.perfil = { ...perfil.perfil, ...data.perfil };
      renderCromo();
      setFichaBanner("Ficha actualizada.", "ok");
    } catch (err) {
      setFichaBanner(err instanceof Error ? err.message : "No se ha podido guardar la ficha.");
    } finally {
      if (fichaSave) {
        fichaSave.disabled = false;
        fichaSave.textContent = original;
      }
    }
  }

  async function subirAvatar() {
    const file = avatarInput?.files?.[0];
    if (!file) return;
    setFichaError("avatar", "");
    const data = new FormData();
    data.append("foto", file);
    try {
      const response = await fetch("/api/avatar", { method: "PUT", credentials: "include", body: data });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "No se ha podido subir la foto.");
      if (perfil) perfil.perfil = { ...perfil.perfil, tieneAvatar: true };
      if (avatarDelete) avatarDelete.hidden = false;
      if (avatarInput) avatarInput.value = "";
      renderCromo();
      setFichaBanner("Foto actualizada.", "ok");
    } catch (err) {
      setFichaError("avatar", err instanceof Error ? err.message : "No se ha podido subir la foto.");
    }
  }

  async function borrarAvatar() {
    try {
      const response = await fetch("/api/avatar", {
        method: "DELETE",
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      if (!response.ok) throw new Error();
      if (perfil) perfil.perfil = { ...perfil.perfil, tieneAvatar: false };
      if (avatarDelete) avatarDelete.hidden = true;
      renderCromo();
      setFichaBanner("Foto quitada.", "ok");
    } catch {
      setFichaError("avatar", "No se ha podido quitar la foto.");
    }
  }

  // --------------------------------------------------------------- carga ----
  async function cargarPerfil() {
    if (cargado) return;
    cargado = true;
    try {
      const response = await fetch("/api/perfil", {
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      if (response.status === 401) {
        cargado = false;
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido cargar tu ficha.");
      perfil = data;
      renderCromo();
      renderHistorial();
      fillFichaForm();
    } catch (err) {
      cromoWrap.textContent = "";
      cromoWrap.appendChild(el("p", "cromo-loading", err instanceof Error ? err.message : "No se ha podido cargar tu ficha."));
    }
  }

  initTabs();
  fichaForm?.addEventListener("submit", guardarFicha);
  avatarInput?.addEventListener("change", subirAvatar);
  avatarDelete?.addEventListener("click", borrarAvatar);

  window.addEventListener("copa:auth", (event) => {
    const detail = event.detail || {};
    if (detail.loading || !detail.user) {
      cargado = false;
      return;
    }
    cargarPerfil();
  });

  if (window.CopaAuth?.state && !window.CopaAuth.state.loading && window.CopaAuth.state.user) {
    cargarPerfil();
  }
})();
