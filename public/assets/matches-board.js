(() => {
  const board = document.querySelector("[data-public-matches]");
  if (!board || !window.CopaArenaMatches) return;

  const matchesApi = window.CopaArenaMatches;
  const status = board.querySelector("[data-matches-status]");
  const list = board.querySelector("[data-matches-list]");
  const bracket = board.querySelector("[data-matches-bracket]");

  async function load() {
    let matches = [];
    try {
      matches = await matchesApi.apiGetMatches();
      matchesApi.writeLocalMatches(matches);
    } catch {
      matches = matchesApi.readLocalMatches();
    }

    list.textContent = "";
    bracket.textContent = "";
    if (!matches.length) {
      status.hidden = false;
      status.textContent = "El calendario aparecera aqui en cuanto la organizacion sortee los cruces.";
      list.hidden = true;
      bracket.hidden = true;
      return;
    }

    status.hidden = true;
    matchesApi.renderBracket(bracket, matches, showDetails);
    bracket.hidden = false;
    matches.forEach((match) => list.appendChild(card(match)));
    list.hidden = false;
  }

  function card(match) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `public-match-card is-${match.status}`;
    item.addEventListener("click", () => showDetails(match));

    const meta = document.createElement("span");
    meta.className = "match-meta";
    meta.textContent = `${matchesApi.statusLabel(match.status)} · ${matchesApi.formatDateTime(match.scheduledAt)}`;

    const teams = document.createElement("strong");
    teams.textContent = `${winnerPrefix(match, "A")}${match.teams.A.name} vs ${winnerPrefix(match, "B")}${match.teams.B.name}`;

    const score = document.createElement("span");
    score.className = "match-scoreline";
    score.textContent =
      match.status === "scheduled"
        ? "Horario confirmado"
        : `${match.sets.A}-${match.sets.B} sets · ${match.points.A}-${match.points.B}`;

    item.append(meta, teams, score);
    return item;
  }

  function showDetails(match) {
    const message =
      `${match.teams.A.name} vs ${match.teams.B.name}\n` +
      `${matchesApi.statusLabel(match.status)} · ${matchesApi.formatDateTime(match.scheduledAt)}\n` +
      `Sets: ${match.sets.A}-${match.sets.B}. Puntos: ${match.points.A}-${match.points.B}.`;
    window.alert(message);
  }

  function winnerPrefix(match, team) {
    return match.winner === team ? "\\u2655 " : "";
  }

  load();
  window.setInterval(load, 15000);
})();
