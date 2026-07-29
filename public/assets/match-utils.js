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

  // Escribir partidos exige sesión de administrador, así que la cookie tiene
  // que viajar. El mensaje del servidor se propaga para poder distinguir un
  // 401/403 (sesión caducada) de una caída de red.
  async function apiAction(payload) {
    return apiWrite("/api/partidos", { method: "POST", body: JSON.stringify(payload) });
  }

  async function apiWrite(url, options = {}) {
    const response = await fetch(url, {
      cache: "no-store",
      credentials: "include",
      ...options,
      headers: { "Content-Type": "application/json", Accept: "application/json", ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const err = new Error(data.error || `No se ha podido guardar (${response.status}).`);
      err.status = response.status;
      throw err;
    }
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

  /*
   * Las reglas vienen con cada partido, en `match.reglas`, y las pone el
   * servidor desde la fase a la que pertenece. Antes estaban escritas a mano
   * aquí (21/21/15, al mejor de tres) y otra vez en functions/api/partidos.ts,
   * sin nada que impidiera que divergieran. Estos valores son solo la red por si
   * un partido viejo llega sin ellas.
   */
  const REGLAS_POR_DEFECTO = { sets: 2, puntosPorSet: 21, puntosSetDecisivo: 15, diferencia: 2 };

  function reglasDe(match) {
    const reglas = match?.reglas;
    if (!reglas || typeof reglas !== "object") return REGLAS_POR_DEFECTO;
    return {
      sets: Number(reglas.sets) || REGLAS_POR_DEFECTO.sets,
      puntosPorSet: Number(reglas.puntosPorSet) || REGLAS_POR_DEFECTO.puntosPorSet,
      puntosSetDecisivo: Number(reglas.puntosSetDecisivo) || REGLAS_POR_DEFECTO.puntosSetDecisivo,
      diferencia: Number(reglas.diferencia) || REGLAS_POR_DEFECTO.diferencia
    };
  }

  const setsMaximos = (reglas) => reglas.sets * 2 - 1;

  /** El último set posible es el corto, salvo que solo haya uno. */
  function setTarget(match, setNumber) {
    const reglas = reglasDe(match);
    const numero = setNumber ?? match.setNumber;
    if (reglas.sets > 1 && numero >= setsMaximos(reglas)) return reglas.puntosSetDecisivo;
    return reglas.puntosPorSet;
  }

  function setWinner(match) {
    const reglas = reglasDe(match);
    const target = setTarget(match);
    const a = match.points.A;
    const b = match.points.B;
    if (a >= target && a - b >= reglas.diferencia) return "A";
    if (b >= target && b - a >= reglas.diferencia) return "B";
    return null;
  }

  function matchWinner(match) {
    const reglas = reglasDe(match);
    if (match.sets.A >= reglas.sets) return "A";
    if (match.sets.B >= reglas.sets) return "B";
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

  /*
   * El cuadro se dibuja con los partidos que hay, agrupados por la ronda que
   * traen del servidor (`rondaOrden` y `ronda`).
   *
   * Antes se fabricaba: se cogían los ocho primeros partidos de la lista, se
   * inventaban cuatro semifinales y una final que no existían en la base, y se
   * pintaba ese árbol pasara lo que pasara. Con doce equipos, o con fase de
   * grupos, aquello enseñaba un cuadro que no era el del torneo.
   */
  function renderBracket(target, matches, onOpen) {
    target.textContent = "";

    const delCuadro = matches.filter((match) => match.rondaOrden !== null && match.rondaOrden !== undefined);
    if (delCuadro.length === 0) return false;

    const rondas = new Map();
    delCuadro.forEach((match) => {
      const clave = match.rondaOrden;
      if (!rondas.has(clave)) rondas.set(clave, { etiqueta: match.ronda || `Ronda ${clave + 1}`, partidos: [] });
      rondas.get(clave).partidos.push(match);
    });

    const bracket = document.createElement("div");
    bracket.className = "tournament-bracket";

    [...rondas.entries()]
      .sort((a, b) => a[0] - b[0])
      .forEach(([, ronda]) => {
        const ordenados = [...ronda.partidos].sort((a, b) => (a.posicion ?? 0) - (b.posicion ?? 0));
        bracket.appendChild(bracketRound(ronda.etiqueta, ordenados, onOpen));
      });

    target.appendChild(bracket);
    return true;
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
    apiWrite,
    createDraw,
    applyPoint,
    elapsed,
    formatClock,
    formatDateTime,
    statusLabel,
    renderBracket,
    reglasDe,
    setTarget,
    clone
  };
})();
