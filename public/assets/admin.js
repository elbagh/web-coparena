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
  const shirtForm = root.querySelector("[data-admin-shirt-form]");
  const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

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

  function limpiar(value) {
    return String(value || "").trim().replace(/\s+/g, " ");
  }

  function shirtField(name) {
    return shirtForm?.querySelector(`[data-admin-shirt-field="${name}"]`);
  }

  function shirtError(name) {
    return shirtForm?.querySelector(`[data-admin-shirt-error="${name}"]`);
  }

  function setShirtBanner(message, kind = "error") {
    const banner = shirtForm?.querySelector("[data-admin-shirt-banner]");
    if (!banner) return;
    banner.textContent = message || "";
    banner.dataset.kind = kind;
    banner.hidden = !message;
  }

  function setShirtFieldError(name, message) {
    const input = shirtField(name);
    const node = shirtError(name);
    if (!input || !node) return;
    node.textContent = message || "";
    node.hidden = !message;
    if (message) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  }

  function clearShirtErrors() {
    setShirtBanner("");
    ["nombre", "talla", "cantidad", "notas"].forEach((name) => setShirtFieldError(name, ""));
  }

  function shirtPayload() {
    return {
      nombre: limpiar(shirtField("nombre")?.value),
      talla: limpiar(shirtField("talla")?.value).toUpperCase(),
      cantidad: Number(shirtField("cantidad")?.value || 1),
      notas: limpiar(shirtField("notas")?.value)
    };
  }

  function validateShirtForm() {
    const data = shirtPayload();
    const errors = {};
    if (data.nombre.length < 2 || data.nombre.length > 80) {
      errors.nombre = "Indica el nombre de la persona que recoge la camiseta.";
    }
    if (!TALLAS.has(data.talla)) {
      errors.talla = "Elige una talla válida.";
    }
    if (!Number.isInteger(data.cantidad) || data.cantidad < 1 || data.cantidad > 10) {
      errors.cantidad = "Puedes reservar entre 1 y 10 camisetas.";
    }
    if (data.notas.length > 240) {
      errors.notas = "Las notas no pueden pasar de 240 caracteres.";
    }
    Object.entries(errors).forEach(([name, message]) => setShirtFieldError(name, message));
    return Object.keys(errors).length === 0 ? data : null;
  }

  function applyShirtServerErrors(campos) {
    Object.entries(campos || {}).forEach(([name, message]) => setShirtFieldError(name, message));
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
        cache: "no-store",
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
        cache: "no-store",
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido borrar.");
      await window.CopaAuth?.refresh?.();
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido borrar.");
    }
  }

  async function submitShirtReservation(event) {
    event.preventDefault();
    clearShirtErrors();

    const data = validateShirtForm();
    if (!data) {
      setShirtBanner("Revisa los campos marcados.");
      return;
    }

    const submit = shirtForm.querySelector("[data-admin-shirt-submit]");
    const original = submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.textContent = "Guardando...";
    }

    try {
      const response = await fetch("/api/admin?type=camiseta", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify(data)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        applyShirtServerErrors(body.campos);
        throw new Error(body.error || "No se ha podido guardar la reserva.");
      }
      shirtField("nombre").value = "";
      shirtField("talla").value = "";
      shirtField("cantidad").value = "1";
      shirtField("notas").value = "";
      setShirtBanner("Reserva de camiseta añadida.", "ok");
      await loadAdmin();
    } catch (err) {
      setShirtBanner(err instanceof Error ? err.message : "No se ha podido guardar la reserva.");
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
        submit.textContent = original;
      }
    }
  }

  refresh?.addEventListener("click", loadAdmin);
  shirtForm?.addEventListener("submit", submitShirtReservation);

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
