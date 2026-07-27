// Listado público de equipos: nombre de equipo y, al desplegar, sus jugadores
// (nombre, apellidos e Instagram). Render exclusivamente con
// createElement/textContent (nunca innerHTML).

(() => {
  const panel = document.querySelector("[data-teams]");
  if (!panel) return;

  const estado = panel.querySelector("[data-status]");
  const lista = panel.querySelector("[data-list]");
  const reintentar = panel.querySelector("[data-retry]");

  function instagramHref(valor) {
    if (/^https?:\/\//i.test(valor)) return valor;
    const handle = valor.replace(/^@/, "");
    return `https://www.instagram.com/${encodeURIComponent(handle)}`;
  }

  function crearJugadorRow(jugador) {
    const item = document.createElement("li");
    item.className = "player-row";

    const nombre = document.createElement("span");
    nombre.className = "player-name";
    nombre.textContent = `${jugador.nombre || ""} ${jugador.apellidos || ""}`.trim();
    item.appendChild(nombre);

    const instagram = typeof jugador.instagram === "string" ? jugador.instagram.trim() : "";
    if (instagram) {
      const esUrl = /^https?:\/\//i.test(instagram);
      const link = document.createElement("a");
      link.className = "player-instagram";
      link.href = instagramHref(instagram);
      link.textContent = esUrl ? instagram : instagram.startsWith("@") ? instagram : `@${instagram}`;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      item.appendChild(link);
    }

    return item;
  }

  function crearEquipoItem(equipo, indice) {
    const jugadores = Array.isArray(equipo.jugadores) ? equipo.jugadores : [];

    const item = document.createElement("li");

    const body = document.createElement("div");
    body.className = "team-body";

    const header = document.createElement("div");
    header.className = "team-header";

    const badge = document.createElement("span");
    badge.className = "team-badge";
    badge.setAttribute("aria-hidden", "true");
    badge.textContent = String(indice + 1);

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "team-toggle";
    const panelId = `team-players-${indice}`;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-controls", panelId);

    const nombre = document.createElement("span");
    nombre.className = "team-name";
    nombre.textContent = String(equipo.nombre || "");

    const cuenta = document.createElement("span");
    cuenta.className = "team-count";
    const n = jugadores.length;
    cuenta.textContent = n === 1 ? "1 jugador" : `${n} jugadores`;

    const chevron = document.createElement("span");
    chevron.className = "team-chevron";
    chevron.setAttribute("aria-hidden", "true");

    toggle.append(nombre, cuenta, chevron);

    const jugadoresList = document.createElement("ul");
    jugadoresList.className = "team-players";
    jugadoresList.id = panelId;
    jugadoresList.hidden = true;
    jugadores.forEach((jugador) => jugadoresList.appendChild(crearJugadorRow(jugador)));

    toggle.addEventListener("click", () => {
      const expandido = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expandido));
      jugadoresList.hidden = expandido;
    });

    header.append(badge, toggle);
    body.append(header, jugadoresList);
    item.appendChild(body);
    return item;
  }

  async function cargar() {
    estado.textContent = "Cargando equipos…";
    estado.hidden = false;
    lista.hidden = true;
    reintentar.hidden = true;

    try {
      const respuesta = await fetch("/api/equipos", {
        cache: "no-store",
        headers: { Accept: "application/json" }
      });
      if (!respuesta.ok) throw new Error(String(respuesta.status));
      const datos = await respuesta.json();
      const equipos = Array.isArray(datos.equipos) ? datos.equipos : [];

      if (equipos.length === 0) {
        estado.textContent = "Aún no hay equipos inscritos. Sé el primero.";
        return;
      }

      lista.textContent = "";
      equipos.forEach((equipo, indice) => {
        lista.appendChild(crearEquipoItem(equipo, indice));
      });
      estado.hidden = true;
      lista.hidden = false;
    } catch {
      estado.textContent = "No se ha podido cargar la lista de equipos.";
      reintentar.hidden = false;
    }
  }

  reintentar.addEventListener("click", cargar);
  cargar();
})();
