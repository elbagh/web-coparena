(() => {
  const panel = document.querySelector("[data-admin-matches]");
  if (!panel || !window.CopaArenaMatches) return;

  const matchesApi = window.CopaArenaMatches;
  const status = panel.querySelector("[data-admin-status]");
  const teamPool = panel.querySelector("[data-team-pool]");
  const bracket = panel.querySelector("[data-admin-bracket]");
  const matchList = panel.querySelector("[data-match-list]");
  const loadTeamsButton = panel.querySelector("[data-load-teams]");
  const drawButton = panel.querySelector("[data-draw]");
  const confirmDrawButton = panel.querySelector("[data-confirm-draw]");
  const teamForm = panel.querySelector("[data-team-form]");
  const dialog = document.querySelector("[data-match-dialog]");
  const dialogBody = document.querySelector("[data-dialog-body]");

  let teams = [];
  let matches = [];
  let draftMatches = null;
  let selectedId = null;
  let apiAvailable = true;

  async function boot() {
    await Promise.all([loadTeams(), loadMatches()]);
    render();
    window.setInterval(renderDialog, 1000);
  }

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
        ? `${teams.length} equipos manuales disponibles. La API de equipos no responde en local.`
        : "Anade equipos manualmente o activa /api/equipos para poder sortear.";
    }
  }

  async function loadMatches() {
    try {
      matches = await matchesApi.apiGetMatches();
      const localMatches = matchesApi.readLocalMatches();
      if (!matches.length && localMatches.length) {
        matches = localMatches;
      } else {
        matchesApi.writeLocalMatches(matches);
      }
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
      const empty = document.createElement("p");
      empty.className = "teams-status";
      empty.textContent = "Todavia no hay equipos cargados.";
      teamPool.appendChild(empty);
      return;
    }
    teams.forEach((team) => {
      const chip = document.createElement("span");
      chip.className = "team-chip";
      const name = document.createElement("span");
      name.textContent = team.name;
      chip.appendChild(name);
      if (manualNames.has(normalizeName(team.name))) {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "team-chip-remove";
        remove.setAttribute("aria-label", `Quitar ${team.name}`);
        remove.textContent = "x";
        remove.addEventListener("click", () => removeManualTeam(team.name));
        chip.appendChild(remove);
      }
      teamPool.appendChild(chip);
    });
  }

  function renderMatches() {
    const visibleMatches = draftMatches || matches;
    matchList.textContent = "";
    bracket.textContent = "";
    if (!visibleMatches.length) {
      const empty = document.createElement("p");
      empty.className = "teams-status";
      empty.textContent = "Aun no hay emparejamientos sorteados.";
      matchList.appendChild(empty);
      bracket.hidden = true;
      return;
    }
    matchesApi.renderBracket(bracket, visibleMatches, (match) => openMatch(match.id));
    bracket.hidden = false;
    visibleMatches.forEach((match) => matchList.appendChild(matchCard(match)));
  }

  function renderDrawActions() {
    if (!confirmDrawButton) return;
    confirmDrawButton.hidden = !draftMatches;
    drawButton.textContent = draftMatches ? "Repetir sorteo" : "Sortear emparejamientos";
  }

  function matchCard(match) {
    const card = document.createElement("article");
    card.className = `admin-match-card is-${match.status}`;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "match-open";
    button.addEventListener("click", () => openMatch(match.id));

    const meta = document.createElement("span");
    meta.className = "match-meta";
    meta.textContent = `${matchesApi.statusLabel(match.status)} · ${matchesApi.formatDateTime(match.scheduledAt)}`;

    const title = document.createElement("strong");
    title.textContent = `${winnerPrefix(match, "A")}${match.teams.A.name} vs ${winnerPrefix(match, "B")}${match.teams.B.name}`;

    const score = document.createElement("span");
    score.className = "match-scoreline";
    score.textContent = `${match.sets.A}-${match.sets.B} sets · ${match.points.A}-${match.points.B}`;

    button.append(meta, title, score);

    const field = document.createElement("label");
    field.className = "match-time-field";
    const label = document.createElement("span");
    label.textContent = "Hora";
    const input = document.createElement("input");
    input.type = "datetime-local";
    input.value = match.scheduledAt ? match.scheduledAt.slice(0, 16) : "";
    input.addEventListener("change", () => scheduleMatch(match.id, input.value));
    field.append(label, input);

    card.append(button, field);
    return card;
  }

  function winnerPrefix(match, team) {
    return match.winner === team ? "\\u2655 " : "";
  }

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
        status.textContent = "La API no responde; guardando en este navegador.";
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
    const head = document.createElement("div");
    head.className = "match-dialog-head";
    const statusBadge = document.createElement("span");
    statusBadge.className = `match-status is-${match.status}`;
    statusBadge.textContent = matchesApi.statusLabel(match.status);
    const title = document.createElement("h2");
    title.textContent = `${match.teams.A.name} vs ${match.teams.B.name}`;
    const time = document.createElement("p");
    time.textContent = matchesApi.formatDateTime(match.scheduledAt);
    head.append(statusBadge, title, time);

    const clock = document.createElement("div");
    clock.className = "match-clock";
    clock.textContent = matchesApi.formatClock(matchesApi.elapsed(match));

    const board = document.createElement("div");
    board.className = "score-board";
    board.append(scoreTeam(match, "A"), scoreTeam(match, "B"));

    const history = document.createElement("p");
    history.className = "set-history";
    history.textContent = match.history.length
      ? `Sets cerrados: ${match.history.map((set) => `${set.a}-${set.b}`).join(" · ")}`
      : "Set en juego. Los sets 1 y 2 van a 21; el tercero a 15. Siempre con diferencia de 2.";

    const controls = document.createElement("div");
    controls.className = "match-controls";
    const start = controlButton("Iniciar partido", () => persist({ action: "start", id: match.id }));
    start.disabled = match.status !== "scheduled";
    const finish = controlButton("Terminar partido", () => persist({ action: "finish", id: match.id }));
    finish.disabled = match.status === "finished";
    controls.append(start, finish);

    dialogBody.append(head, clock, board, history, controls);
  }

  function scoreTeam(match, team) {
    const wrap = document.createElement("section");
    wrap.className = `score-team ${match.winner === team ? "is-winner" : ""}`;
    const name = document.createElement("h3");
    name.textContent = match.teams[team].name;
    const points = document.createElement("strong");
    points.textContent = match.points[team];
    const sets = document.createElement("span");
    sets.textContent = `${match.sets[team]} sets`;
    const actions = document.createElement("div");
    actions.className = "score-actions";
    actions.append(
      controlButton("-", () => persist({ action: "point", id: match.id, team, delta: -1 })),
      controlButton("+", () => persist({ action: "point", id: match.id, team, delta: 1 }))
    );
    actions.querySelectorAll("button").forEach((button) => {
      button.disabled = match.status === "finished";
    });
    wrap.append(name, points, sets, actions);
    return wrap;
  }

  function controlButton(text, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "add-player";
    button.textContent = text;
    button.addEventListener("click", onClick);
    return button;
  }

  async function scheduleMatch(id, value) {
    if (draftMatches) {
      draftMatches = draftMatches.map((match) =>
        match.id === id ? { ...match, scheduledAt: value ? new Date(value).toISOString() : null } : match
      );
      render();
      return;
    }
    await persist({ action: "schedule", id, scheduledAt: value ? new Date(value).toISOString() : null });
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

  function normalizeName(name) {
    return String(name || "").trim().toLocaleLowerCase("es");
  }

  async function removeManualTeam(name) {
    const key = normalizeName(name);
    const manual = matchesApi.readManualTeams().filter((team) => normalizeName(team.name) !== key);
    matchesApi.writeManualTeams(manual);
    await loadTeams();
    if (draftMatches) {
      draftMatches = null;
      status.textContent = "Equipo eliminado. Repite el sorteo y confirma de nuevo.";
    }
    render();
  }

  loadTeamsButton.addEventListener("click", async () => {
    await loadTeams();
    render();
  });

  drawButton.addEventListener("click", async () => {
    if (teams.length < 2) {
      status.textContent = "Necesitas al menos dos equipos para sortear.";
      return;
    }
    draftMatches = matchesApi.createDraw(teams);
    status.textContent = "Sorteo preparado. Revisa el cuadro y pulsa Confirmar sorteo para guardarlo.";
    render();
  });

  confirmDrawButton?.addEventListener("click", async () => {
    if (!draftMatches?.length) return;
    await persist({ action: "draw", partidos: draftMatches });
    status.textContent = "Sorteo confirmado. Ya aparece en Horario y marcador.";
  });

  teamForm.addEventListener("submit", (event) => {
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

  boot();
})();
