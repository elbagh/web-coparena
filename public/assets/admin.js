(() => {
  const root = document.querySelector("[data-admin]");
  if (!root) return;

  const loading = root.querySelector("[data-admin-loading]");
  const error = root.querySelector("[data-admin-error]");
  const stats = root.querySelector("[data-admin-stats]");
  const content = root.querySelector("[data-admin-content]");
  const teams = root.querySelector("[data-admin-teams]");
  const shirts = root.querySelector("[data-admin-shirts]");
  const refresh = root.querySelector("[data-admin-refresh]");

  function showLoading(isLoading) {
    loading.hidden = !isLoading;
    if (isLoading) {
      stats.hidden = true;
      content.hidden = true;
      setError("");
    }
  }

  function setError(message) {
    error.textContent = message || "";
    error.hidden = !message;
  }

  function text(value) {
    return value === null || value === undefined || value === "" ? "—" : String(value);
  }

  function clear(node) {
    node.textContent = "";
  }

  function el(tag, className, value) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value !== undefined) node.textContent = text(value);
    return node;
  }

  function renderStats(data) {
    clear(stats);
    const items = [
      ["Equipos", data.stats?.equipos || 0],
      ["Jugadores", data.stats?.jugadores || 0],
      ["Camisetas", data.stats?.camisetas || 0],
      ["Reservas", data.stats?.reservasCamisetas || 0]
    ];

    items.forEach(([label, value]) => {
      const card = el("article", "admin-stat");
      card.append(el("strong", "", value));
      card.append(el("span", "", label));
      stats.append(card);
    });
    stats.hidden = false;
  }

  function renderTeams(data) {
    clear(teams);
    const list = Array.isArray(data.equipos) ? data.equipos : [];
    if (list.length === 0) {
      teams.append(el("p", "teams-status", "No hay equipos registrados."));
      return;
    }

    list.forEach((team) => {
      const card = el("article", "admin-item");
      const head = el("div", "admin-item-head");
      const titleWrap = el("div", "");
      titleWrap.append(el("h3", "", team.nombre));
      titleWrap.append(el("p", "", `Cuenta: ${text(team.ownerEmail)} · Jugadores: ${team.jugadoresTotal || 0}`));
      head.append(titleWrap);
      head.append(dangerButton("Borrar", () => deleteItem("equipo", team.id, `¿Borrar el equipo ${team.nombre}?`)));
      card.append(head);

      const players = el("div", "admin-sublist");
      (team.jugadores || []).forEach((player) => {
        const item = el("div", "admin-subitem");
        item.append(el("strong", "", `${player.nombre} ${player.apellidos}`));
        item.append(el("span", "", `${player.esSuplente ? "Suplente" : "Titular"} · ${text(player.telefono)} · ${text(player.email)}`));
        players.append(item);
      });
      card.append(players);
      teams.append(card);
    });
  }

  function renderShirts(data) {
    clear(shirts);
    const list = Array.isArray(data.camisetas) ? data.camisetas : [];
    if (list.length === 0) {
      shirts.append(el("p", "teams-status", "No hay camisetas reservadas."));
      return;
    }

    list.forEach((shirt) => {
      const card = el("article", "admin-item admin-shirt-item");
      const head = el("div", "admin-item-head");
      const titleWrap = el("div", "");
      titleWrap.append(el("h3", "", `${shirt.cantidad} x talla ${shirt.talla}`));
      titleWrap.append(el("p", "", `${shirt.nombre} · ${text(shirt.ownerEmail)}`));
      if (shirt.notas) titleWrap.append(el("p", "admin-note", shirt.notas));
      head.append(titleWrap);
      head.append(dangerButton("Borrar", () => deleteItem("camiseta", shirt.id, "¿Borrar esta reserva de camiseta?")));
      card.append(head);
      shirts.append(card);
    });
  }

  function dangerButton(label, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-remove admin-danger";
    button.textContent = label;
    button.addEventListener("click", onClick);
    return button;
  }

  async function loadAdmin() {
    showLoading(true);
    try {
      const response = await fetch("/api/admin", {
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido cargar el panel.");
      renderStats(data);
      renderTeams(data);
      renderShirts(data);
      content.hidden = false;
      setError("");
    } catch (err) {
      stats.hidden = true;
      content.hidden = true;
      setError(err instanceof Error ? err.message : "No se ha podido cargar el panel.");
    } finally {
      showLoading(false);
    }
  }

  async function deleteItem(type, id, message) {
    if (!window.confirm(message)) return;
    try {
      const response = await fetch(`/api/admin?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido borrar.");
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido borrar.");
    }
  }

  refresh?.addEventListener("click", loadAdmin);

  window.addEventListener("copa:auth", (event) => {
    const detail = event.detail || {};
    if (detail.loading) {
      showLoading(true);
      return;
    }
    if (!detail.user) {
      showLoading(false);
      stats.hidden = true;
      content.hidden = true;
      setError("");
      return;
    }
    loadAdmin();
  });

  if (window.CopaAuth?.state && !window.CopaAuth.state.loading && window.CopaAuth.state.user) {
    loadAdmin();
  }
})();
