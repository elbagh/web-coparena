window.CopaArenaMatches = (() => {
  const storageKey = "copa-arena-partidos";
  const teamStorageKey = "copa-arena-equipos-manuales";

  function readJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key) || "");
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function readLocalMatches() {
    return readJson(storageKey, []);
  }

  function writeLocalMatches(matches) {
    localStorage.setItem(storageKey, JSON.stringify(matches));
  }

  function readManualTeams() {
    return readJson(teamStorageKey, []);
  }

  function writeManualTeams(teams) {
    localStorage.setItem(teamStorageKey, JSON.stringify(teams));
  }

  async function apiGetMatches() {
    const response = await fetch("/api/partidos", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    return Array.isArray(data.partidos) ? data.partidos : [];
  }

  async function apiAction(payload) {
    const response = await fetch("/api/partidos", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    return Array.isArray(data.partidos) ? data.partidos : [];
  }

  function createDraw(teams) {
    const shuffled = [...teams].sort(() => Math.random() - 0.5);
    const matches = [];
    for (let i = 0; i + 1 < shuffled.length; i += 2) {
      matches.push(newMatch(shuffled[i], shuffled[i + 1], matches.length));
    }
    return matches;
  }

  function newMatch(teamA, teamB, index) {
    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${index}`,
      ronda: "Sorteo",
      scheduledAt: null,
      status: "scheduled",
      setNumber: 1,
      points: { A: 0, B: 0 },
      sets: { A: 0, B: 0 },
      history: [],
      startedAt: null,
      elapsedMs: 0,
      winner: null,
      teams: { A: teamA, B: teamB }
    };
  }

  function setTarget(setNumber) {
    return setNumber >= 3 ? 15 : 21;
  }

  function setWinner(match) {
    const target = setTarget(match.setNumber);
    const a = match.points.A;
    const b = match.points.B;
    if (a >= target && a - b >= 2) return "A";
    if (b >= target && b - a >= 2) return "B";
    return null;
  }

  function matchWinner(match) {
    if (match.sets.A >= 2) return "A";
    if (match.sets.B >= 2) return "B";
    return null;
  }

  function clone(value) {
    return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
  }

  function applyPoint(match, team, delta) {
    const next = clone(match);
    if (next.status === "finished") return next;
    next.points[team] = Math.max(0, next.points[team] + delta);
    if (delta > 0) {
      const winner = setWinner(next);
      if (winner) {
        next.history.push({ a: next.points.A, b: next.points.B });
        next.sets[winner] += 1;
        next.points = { A: 0, B: 0 };
        next.setNumber += 1;
        const finalWinner = matchWinner(next);
        if (finalWinner) {
          next.elapsedMs = elapsed(next);
          next.status = "finished";
          next.winner = finalWinner;
        }
      }
    }
    return next;
  }

  function elapsed(match) {
    const base = Number(match.elapsedMs) || 0;
    if (match.status !== "live" || !match.startedAt) return base;
    return base + Math.max(0, Date.now() - new Date(match.startedAt).getTime());
  }

  function formatClock(ms) {
    const total = Math.floor(ms / 1000);
    const minutes = String(Math.floor(total / 60)).padStart(2, "0");
    const seconds = String(total % 60).padStart(2, "0");
    return `${minutes}:${seconds}`;
  }

  function formatDateTime(value) {
    if (!value) return "Hora pendiente";
    return new Intl.DateTimeFormat("es", {
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(value));
  }

  function statusLabel(status) {
    if (status === "live") return "Jugando";
    if (status === "finished") return "Terminado";
    return "Programado";
  }

  function winnerName(match) {
    if (!match?.winner) return "";
    return match.teams[match.winner]?.name || "";
  }

  function renderBracket(target, matches, onOpen) {
    target.textContent = "";
    const bracket = document.createElement("div");
    bracket.className = "tournament-bracket";

    const firstRound = matches.slice(0, 8);
    const semis = buildNextRound(firstRound, "Semifinal");
    const final = buildNextRound(semis, "Final");

    bracket.append(
      bracketRound("Sorteo", firstRound, onOpen),
      bracketRound("Semifinal", semis, onOpen),
      bracketRound("Final", final.slice(0, 1), onOpen)
    );
    target.appendChild(bracket);
  }

  function buildNextRound(previous, label) {
    const next = [];
    for (let i = 0; i < previous.length; i += 2) {
      const teamA = winnerName(previous[i]) || `${label} ${Math.floor(i / 2) + 1}`;
      const teamB = winnerName(previous[i + 1]) || "Por decidir";
      next.push({
        id: "",
        status: "scheduled",
        scheduledAt: null,
        points: { A: 0, B: 0 },
        sets: { A: 0, B: 0 },
        winner: null,
        teams: {
          A: { id: null, name: teamA },
          B: { id: null, name: teamB }
        }
      });
    }
    return next.length ? next : [];
  }

  function bracketRound(label, matches, onOpen) {
    const round = document.createElement("section");
    round.className = `bracket-round bracket-round-${label.toLowerCase()}`;
    const title = document.createElement("h3");
    title.textContent = label;
    round.appendChild(title);

    if (!matches.length) {
      round.appendChild(bracketMatch(null));
      return round;
    }

    matches.forEach((match) => round.appendChild(bracketMatch(match, onOpen)));
    return round;
  }

  function bracketMatch(match, onOpen) {
    const item = document.createElement(match?.id ? "button" : "div");
    item.className = `bracket-match ${match ? `is-${match.status}` : "is-empty"}`;
    if (match?.id) {
      item.type = "button";
      item.addEventListener("click", () => onOpen?.(match));
    }

    const time = document.createElement("span");
    time.className = "bracket-time";
    time.textContent = match?.scheduledAt ? formatDateTime(match.scheduledAt) : "Hora pendiente";

    const teamA = bracketTeam(match, "A");
    const vs = document.createElement("span");
    vs.className = "bracket-vs";
    vs.textContent = "Vs.";
    const teamB = bracketTeam(match, "B");

    item.append(time, teamA, vs, teamB);
    return item;
  }

  function bracketTeam(match, team) {
    const row = document.createElement("span");
    row.className = `bracket-team ${match?.winner === team ? "is-winner" : ""}`;
    row.textContent = match?.teams?.[team]?.name || "Por decidir";
    return row;
  }

  return {
    readLocalMatches,
    writeLocalMatches,
    readManualTeams,
    writeManualTeams,
    apiGetMatches,
    apiAction,
    createDraw,
    applyPoint,
    elapsed,
    formatClock,
    formatDateTime,
    statusLabel,
    renderBracket,
    clone
  };
})();
