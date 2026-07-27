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
  const { onReady, el } = window.CopaAdmin;

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
  let apiAvailable = true;
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

  async function loadMatches() {
    try {
      matches = await matchesApi.apiGetMatches();
      const localMatches = matchesApi.readLocalMatches();
      if (!matches.length && localMatches.length) matches = localMatches;
      else matchesApi.writeLocalMatches(matches);
      apiAvailable = true;
    } catch {
      matches = matchesApi.readLocalMatches();
      apiAvailable = false;
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
    matchesApi.renderBracket(bracket, visibleMatches, (match) => openMatch(match.id));
    bracket.hidden = false;
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

    card.append(button, field);
    return card;
  }

  const winnerPrefix = (match, team) => (match.winner === team ? "♕ " : "");

  async function persist(action) {
    if (apiAvailable) {
      try {
        matches = await matchesApi.apiAction(action);
        matchesApi.writeLocalMatches(matches);
        draftMatches = null;
        render();
        renderDialog();
        return;
      } catch {
        apiAvailable = false;
        status.textContent = "La API no responde; guardando solo en este navegador.";
      }
    }
    applyLocal(action);
    matchesApi.writeLocalMatches(matches);
    draftMatches = null;
    render();
    renderDialog();
  }

  function applyLocal(action) {
    if (action.action === "draw") {
      matches = action.partidos ? matchesApi.clone(action.partidos) : matchesApi.createDraw(action.equipos);
      return;
    }
    matches = matches.map((match) => {
      if (match.id !== action.id) return match;
      const next = matchesApi.clone(match);
      if (action.action === "schedule") {
        next.scheduledAt = action.scheduledAt || null;
      } else if (action.action === "start") {
        next.status = "live";
        next.startedAt = next.startedAt || new Date().toISOString();
      } else if (action.action === "point") {
        return matchesApi.applyPoint(next, action.team === "B" ? "B" : "A", Number(action.delta) < 0 ? -1 : 1);
      } else if (action.action === "finish") {
        next.elapsedMs = matchesApi.elapsed(next);
        next.status = "finished";
        next.winner = next.sets.A > next.sets.B || next.points.A >= next.points.B ? "A" : "B";
      }
      return next;
    });
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
