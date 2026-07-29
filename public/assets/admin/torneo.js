/*
 * /admin/torneo/ — sorteo, horarios y marcador en vivo.
 *
 * Se apoya en window.CopaArenaMatches (public/assets/match-utils.js), que
 * comparte con el tablero público de la portada: reglas de set, cuadro y
 * formatos de fecha están ahí y no se duplican aquí.
 *
 * Mantiene el respaldo en localStorage cuando /api/partidos no responde, que
 * es lo que permite arbitrar sin cobertura a pie de pista.
 */
(() => {
  const panel = document.querySelector("[data-admin-matches]");
  if (!panel || !window.CopaArenaMatches || !window.CopaAdmin) return;

  const matchesApi = window.CopaArenaMatches;
  const { onReady, el, setError, confirmar, limpiar } = window.CopaAdmin;

  const status = panel.querySelector("[data-admin-status]");
  const teamPool = panel.querySelector("[data-team-pool]");
  const bracket = panel.querySelector("[data-admin-bracket]");
  const matchList = panel.querySelector("[data-match-list]");
  const loadTeamsButton = panel.querySelector("[data-load-teams]");
  const drawButton = panel.querySelector("[data-draw]");
  const confirmDrawButton = panel.querySelector("[data-confirm-draw]");
  const teamForm = panel.querySelector("[data-match-team-form]");
  const dialog = document.querySelector("[data-match-dialog]");
  const dialogBody = document.querySelector("[data-dialog-body]");

  let teams = [];
  let matches = [];
  let draftMatches = null;
  let selectedId = null;
  let relojIniciado = false;

  onReady(async () => {
    await Promise.all([loadTeams(), loadMatches()]);
    render();
    if (!relojIniciado) {
      // El marcador en vivo tiene cronómetro: se repinta cada segundo mientras
      // el diálogo está abierto.
      window.setInterval(renderDialog, 1000);
      relojIniciado = true;
    }
  });

  async function loadTeams() {
    const manual = matchesApi.readManualTeams();
    try {
      const response = await fetch("/api/equipos", { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json();
      const apiTeams = Array.isArray(data.equipos)
        ? data.equipos.map((team, index) => ({
            id: Number.isFinite(Number(team.id)) ? Number(team.id) : null,
            name: String(team.nombre || `Equipo ${index + 1}`)
          }))
        : [];
      teams = dedupeTeams([...apiTeams, ...manual]);
      status.textContent = `${teams.length} equipos disponibles.`;
    } catch {
      teams = dedupeTeams(manual);
      status.textContent = teams.length
        ? `${teams.length} equipos manuales disponibles. La API de equipos no responde.`
        : "Añade equipos a mano o arregla /api/equipos para poder sortear.";
    }
  }

  // La lectura sí conserva el respaldo local: si la API no responde a pie de
  // pista, al menos se sigue viendo el cuadro. Escribir, en cambio, ya no cae
  // en localStorage: un guardado que no llega a la base tiene que doler.
  async function loadMatches() {
    try {
      matches = await matchesApi.apiGetMatches();
      const localMatches = matchesApi.readLocalMatches();
      if (!matches.length && localMatches.length) matches = localMatches;
      else matchesApi.writeLocalMatches(matches);
    } catch {
      matches = matchesApi.readLocalMatches();
      setError("No se ha podido leer el calendario. Se muestra la última copia de este navegador.");
    }
  }

  function render() {
    renderTeams();
    renderMatches();
    renderDrawActions();
  }

  function renderTeams() {
    teamPool.textContent = "";
    const manualNames = new Set(matchesApi.readManualTeams().map((team) => normalizeName(team.name)));
    if (!teams.length) {
      teamPool.append(el("p", "admin-hint", "Todavía no hay equipos cargados."));
      return;
    }
    teams.forEach((team) => {
      const chip = el("span", "team-chip");
      chip.append(el("span", "", team.name));
      if (manualNames.has(normalizeName(team.name))) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "team-chip-remove";
        remove.setAttribute("aria-label", `Quitar ${team.name}`);
        remove.textContent = "×";
        remove.addEventListener("click", () => removeManualTeam(team.name));
        chip.append(remove);
      }
      teamPool.append(chip);
    });
  }

  function renderMatches() {
    const visibleMatches = draftMatches || matches;
    matchList.textContent = "";
    bracket.textContent = "";
    if (!visibleMatches.length) {
      matchList.append(el("p", "admin-hint", "Aún no hay emparejamientos sorteados."));
      bracket.hidden = true;
      return;
    }
    // Devuelve false cuando no hay partidos de cuadro (una liga no forma árbol).
    bracket.hidden = !matchesApi.renderBracket(bracket, visibleMatches, (match) => openMatch(match.id));
    visibleMatches.forEach((match) => matchList.append(matchCard(match)));
  }

  function renderDrawActions() {
    if (!confirmDrawButton) return;
    confirmDrawButton.hidden = !draftMatches;
    drawButton.textContent = draftMatches ? "Repetir sorteo" : "Sortear emparejamientos";
  }

  function matchCard(match) {
    const card = el("article", `admin-match-card is-${match.status}`);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "match-open";
    button.addEventListener("click", () => openMatch(match.id));

    const meta = el(
      "span",
      "match-meta",
      `${matchesApi.statusLabel(match.status)} · ${matchesApi.formatDateTime(match.scheduledAt)}`
    );
    const title = el(
      "strong",
      "",
      `${winnerPrefix(match, "A")}${match.teams.A.name} vs ${winnerPrefix(match, "B")}${match.teams.B.name}`
    );
    const score = el("span", "match-scoreline", `${match.sets.A}-${match.sets.B} sets · ${match.points.A}-${match.points.B}`);
    button.append(meta, title, score);

    const field = el("label", "match-time-field");
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.value = match.scheduledAt ? match.scheduledAt.slice(0, 16) : "";
    input.addEventListener("change", () => scheduleMatch(match.id, input.value));
    field.append(el("span", "", "Hora"), input);

    const acciones = el("div", "match-card-acciones");
    acciones.append(
      botonChico("Editar", () => abrirEdicion(match)),
      botonChico("Borrar", () => borrarPartido(match), "admin-btn admin-btn--sm admin-btn--danger")
    );
    field.append(acciones);

    card.append(button, field);
    return card;
  }

  function botonChico(texto, onClick, clase = "admin-btn admin-btn--sm") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = clase;
    b.textContent = texto;
    b.addEventListener("click", onClick);
    return b;
  }

  async function borrarPartido(match) {
    const ok = await confirmar({
      titulo: "Borrar partido",
      texto: `Se va a borrar ${match.teams.A.name} vs ${match.teams.B.name}.`,
      accion: "Borrar partido"
    });
    if (!ok) return;
    await escribir(`/api/partidos?id=${encodeURIComponent(match.id)}`, { method: "DELETE" });
  }

  const winnerPrefix = (match, team) => (match.winner === team ? "♕ " : "");

  /**
   * Escribir siempre va contra el servidor. Antes había un respaldo silencioso
   * en localStorage: si la API fallaba, el marcador seguía funcionando en
   * pantalla mientras la base no se enteraba de nada. Ahora un fallo se dice.
   */
  async function persist(action) {
    try {
      matches = await matchesApi.apiAction(action);
      matchesApi.writeLocalMatches(matches);
      draftMatches = null;
      setError("");
      render();
      renderDialog();
    } catch (err) {
      setError(
        err.status === 401 || err.status === 403
          ? "Tu sesión de administrador ha caducado. Recarga la página e inicia sesión otra vez."
          : err.message
      );
    }
  }

  async function escribir(url, options) {
    try {
      matches = await matchesApi.apiWrite(url, options);
      matchesApi.writeLocalMatches(matches);
      draftMatches = null;
      setError("");
      render();
      renderDialog();
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    }
  }

  function openMatch(id) {
    if (draftMatches) {
      status.textContent = "Confirma el sorteo antes de abrir un partido o poner horarios.";
      return;
    }
    selectedId = id;
    renderDialog();
    if (dialog && typeof dialog.showModal === "function") dialog.showModal();
  }

  function renderDialog() {
    if (!dialogBody || !selectedId || !dialog?.open) return;
    const match = matches.find((item) => item.id === selectedId);
    if (!match) return;

    dialogBody.textContent = "";

    const head = el("div", "match-dialog-head");
    head.append(
      el("span", `match-status is-${match.status}`, matchesApi.statusLabel(match.status)),
      el("h2", "", `${match.teams.A.name} vs ${match.teams.B.name}`),
      el("p", "", matchesApi.formatDateTime(match.scheduledAt))
    );

    const clock = el("div", "match-clock", matchesApi.formatClock(matchesApi.elapsed(match)));

    const board = el("div", "score-board");
    board.append(scoreTeam(match, "A"), scoreTeam(match, "B"));

    const history = el(
      "p",
      "set-history",
      match.history.length
        ? `Sets cerrados: ${match.history.map((set) => `${set.a}-${set.b}`).join(" · ")}`
        : "Set en juego. Los sets 1 y 2 van a 21; el tercero a 15. Siempre con diferencia de 2."
    );

    const controls = el("div", "match-controls");
    const start = controlButton("Iniciar partido", () => persist({ action: "start", id: match.id }));
    start.disabled = match.status !== "scheduled";
    const finish = controlButton("Terminar partido", () => persist({ action: "finish", id: match.id }));
    finish.disabled = match.status === "finished";
    controls.append(start, finish);

    dialogBody.append(head, clock, board, history, controls);
  }

  function scoreTeam(match, team) {
    const wrap = el("section", `score-team ${match.winner === team ? "is-winner" : ""}`);
    const actions = el("div", "score-actions");
    actions.append(
      controlButton("−", () => persist({ action: "point", id: match.id, team, delta: -1 })),
      controlButton("+", () => persist({ action: "point", id: match.id, team, delta: 1 }))
    );
    actions.querySelectorAll("button").forEach((button) => {
      button.disabled = match.status === "finished";
    });

    wrap.append(
      el("h3", "", match.teams[team].name),
      el("strong", "", match.points[team]),
      el("span", "", `${match.sets[team]} sets`),
      actions
    );
    return wrap;
  }

  function controlButton(texto, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "admin-btn";
    button.textContent = texto;
    button.addEventListener("click", onClick);
    return button;
  }

  async function scheduleMatch(id, value) {
    const iso = value ? new Date(value).toISOString() : null;
    if (draftMatches) {
      draftMatches = draftMatches.map((match) => (match.id === id ? { ...match, scheduledAt: iso } : match));
      render();
      return;
    }
    await persist({ action: "schedule", id, scheduledAt: iso });
  }

  function dedupeTeams(items) {
    const seen = new Set();
    return items.filter((team) => {
      const name = String(team.name || "").trim();
      const key = normalizeName(name);
      if (!name || seen.has(key)) return false;
      seen.add(key);
      team.name = name;
      return true;
    });
  }

  const normalizeName = (name) => String(name || "").trim().toLocaleLowerCase("es");

  async function removeManualTeam(name) {
    const key = normalizeName(name);
    matchesApi.writeManualTeams(matchesApi.readManualTeams().filter((team) => normalizeName(team.name) !== key));
    await loadTeams();
    if (draftMatches) {
      draftMatches = null;
      status.textContent = "Equipo eliminado. Repite el sorteo y confirma de nuevo.";
    }
    render();
  }

  loadTeamsButton?.addEventListener("click", async () => {
    await loadTeams();
    render();
  });

  drawButton?.addEventListener("click", () => {
    if (teams.length < 2) {
      status.textContent = "Necesitas al menos dos equipos para sortear.";
      return;
    }
    draftMatches = matchesApi.createDraw(teams);
    status.textContent = "Sorteo preparado. Revisa el cuadro y pulsa «Confirmar sorteo» para guardarlo.";
    render();
  });

  confirmDrawButton?.addEventListener("click", async () => {
    if (!draftMatches?.length) return;
    await persist({ action: "draw", partidos: draftMatches });
    status.textContent = "Sorteo confirmado. Ya aparece en la portada.";
  });

  // ------------------------------------------- alta y edición manual ---

  const dialogoPartido = document.querySelector("[data-partido-dialog]");
  const formPartido = dialogoPartido?.querySelector("[data-partido-form]");
  let partidoEnEdicion = null;

  const campoPartido = (nombre) => formPartido?.querySelector(`[data-partido-field="${nombre}"]`);

  function bannerPartido(mensaje) {
    const b = dialogoPartido?.querySelector("[data-partido-banner]");
    if (!b) return;
    b.textContent = mensaje || "";
    b.hidden = !mensaje;
  }

  function abrirEdicion(match) {
    if (!dialogoPartido) return;
    partidoEnEdicion = match;
    bannerPartido("");
    dialogoPartido.querySelector("[data-partido-titulo]").textContent = match
      ? `${match.teams.A.name} vs ${match.teams.B.name}`
      : "Nuevo partido";

    campoPartido("ronda").value = match?.ronda || "Sorteo";
    campoPartido("equipoANombre").value = match?.teams.A.name || "";
    campoPartido("equipoBNombre").value = match?.teams.B.name || "";
    campoPartido("scheduledAt").value = match?.scheduledAt ? match.scheduledAt.slice(0, 16) : "";

    // El marcador solo se toca al editar: un partido nuevo nace a cero.
    const bloqueMarcador = dialogoPartido.querySelector("[data-partido-marcador]");
    bloqueMarcador.hidden = !match;
    if (match) {
      campoPartido("status").value = match.status;
      campoPartido("pointsA").value = String(match.points.A);
      campoPartido("pointsB").value = String(match.points.B);
      campoPartido("setsA").value = String(match.sets.A);
      campoPartido("setsB").value = String(match.sets.B);
      campoPartido("winner").value = match.winner || "";
    }

    dialogoPartido.showModal();
  }

  dialogoPartido?.querySelector("[data-partido-guardar]")?.addEventListener("click", async () => {
    bannerPartido("");
    const equipoA = limpiar(campoPartido("equipoANombre").value);
    const equipoB = limpiar(campoPartido("equipoBNombre").value);
    if (!equipoA || !equipoB) {
      bannerPartido("Indica los dos equipos.");
      return;
    }

    const hora = campoPartido("scheduledAt").value;
    const datos = {
      ronda: limpiar(campoPartido("ronda").value) || "Sorteo",
      equipoANombre: equipoA,
      equipoBNombre: equipoB,
      scheduledAt: hora ? new Date(hora).toISOString() : null
    };

    let ok;
    if (partidoEnEdicion) {
      Object.assign(datos, {
        status: campoPartido("status").value,
        pointsA: Number(campoPartido("pointsA").value || 0),
        pointsB: Number(campoPartido("pointsB").value || 0),
        setsA: Number(campoPartido("setsA").value || 0),
        setsB: Number(campoPartido("setsB").value || 0),
        winner: campoPartido("winner").value || null
      });
      ok = await escribir(`/api/partidos?id=${encodeURIComponent(partidoEnEdicion.id)}`, {
        method: "PATCH",
        body: JSON.stringify(datos)
      });
    } else {
      ok = await escribir("/api/partidos", {
        method: "POST",
        body: JSON.stringify({ action: "crear", ...datos })
      });
    }

    if (ok) dialogoPartido.close();
    else bannerPartido("No se ha podido guardar. Revisa el aviso de arriba.");
  });

  document.querySelector("[data-partido-nuevo]")?.addEventListener("click", () => abrirEdicion(null));
  dialogoPartido?.querySelector("[data-partido-cerrar]")?.addEventListener("click", () => dialogoPartido.close());
  dialogoPartido?.querySelector("[data-partido-cancelar]")?.addEventListener("click", () => dialogoPartido.close());
  dialogoPartido?.addEventListener("close", () => {
    partidoEnEdicion = null;
  });

  document.querySelector("[data-vaciar-partidos]")?.addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "Vaciar el cuadro",
      texto: `Se van a borrar los ${matches.length} partidos.`,
      aviso: "Se pierden horarios y marcadores. No se puede deshacer.",
      accion: "Vaciar el cuadro"
    });
    if (!ok) return;
    await escribir("/api/partidos?todos=1", { method: "DELETE" });
  });

  teamForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = teamForm.elements.team;
    const name = input.value.trim();
    if (!name) return;
    const manual = matchesApi.readManualTeams();
    manual.push({ id: null, name });
    matchesApi.writeManualTeams(dedupeTeams(manual));
    input.value = "";
    loadTeams().then(render);
  });
})();
