(() => {
  const root = document.querySelector("[data-my-team]");
  if (!root) return;

  const loading = root.querySelector("[data-my-team-loading]");
  const empty = root.querySelector("[data-my-team-empty]");
  const editor = root.querySelector("[data-my-team-editor]");
  const form = root.querySelector("[data-my-team-form]");
  const banner = root.querySelector("[data-my-team-banner]");
  const players = root.querySelector("[data-my-team-players]");
  const addPlayer = root.querySelector("[data-my-team-add-player]");
  const save = root.querySelector("[data-my-team-save]");
  const remove = root.querySelector("[data-my-team-delete]");
  const template = document.getElementById("my-team-player-template");

  const MIN_JUGADORES = 2;
  const MAX_JUGADORES = 15;

  const limpiar = (value) => String(value || "").trim().replace(/\s+/g, " ");
  const emailNormalizado = (value) => limpiar(value).toLowerCase();
  const cards = () => Array.from(players.querySelectorAll("[data-player]"));
  const currentUserEmail = () => window.CopaAuth?.state?.user?.email || "";

  function setBanner(message, kind = "error") {
    banner.textContent = message || "";
    banner.dataset.kind = kind;
    banner.hidden = !message;
    if (message) banner.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function setBusy(isBusy) {
    save.disabled = isBusy;
    remove.disabled = isBusy;
    addPlayer.disabled = isBusy || cards().length >= MAX_JUGADORES;
    save.setAttribute("aria-busy", isBusy ? "true" : "false");
  }

  function show(mode) {
    loading.hidden = mode !== "loading";
    empty.hidden = mode !== "empty";
    editor.hidden = mode !== "editor";
  }

  function createPlayer(data = {}) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.querySelector('[data-field="nombre"]').value = data.nombre || "";
    card.querySelector('[data-field="apellidos"]').value = data.apellidos || "";
    card.querySelector('[data-field="telefono"]').value = data.telefono || "";
    card.querySelector('[data-field="email"]').value = data.email || "";
    card.querySelector('[data-field="redSocial"]').value = data.redSocial || "";
    card.querySelector("[data-remove]").addEventListener("click", () => {
      card.remove();
      reindex();
    });
    players.appendChild(card);
    reindex();
  }

  function reindex() {
    const list = cards();
    list.forEach((card, index) => {
      card.querySelector("[data-dorsal]").textContent = String(index + 1);
      card.querySelector("[data-role]").textContent = index < MIN_JUGADORES ? "Titular" : "Suplente";
      card.classList.toggle("is-suplente", index >= MIN_JUGADORES);
      card.querySelector("[data-remove]").hidden = index < MIN_JUGADORES;
    });
    addPlayer.disabled = list.length >= MAX_JUGADORES;
    addPlayer.textContent = list.length >= MAX_JUGADORES ? `Máximo ${MAX_JUGADORES} personas por equipo` : "+ Añadir suplente";
  }

  function renderTeam(team) {
    form.querySelector('[data-field="equipo"]').value = team.nombre || "";
    players.textContent = "";
    const jugadores = Array.isArray(team.jugadores) ? team.jugadores : [];
    jugadores.forEach((player) => createPlayer(player));
    while (cards().length < MIN_JUGADORES) createPlayer();
    setBanner("");
    show("editor");
  }

  function getPlayer(card) {
    const value = (field) => limpiar(card.querySelector(`[data-field="${field}"]`)?.value);
    const player = {
      nombre: value("nombre"),
      apellidos: value("apellidos"),
      telefono: value("telefono")
    };
    const email = value("email");
    const redSocial = value("redSocial");
    if (email) player.email = email;
    if (redSocial) player.redSocial = redSocial;
    return player;
  }

  function payload() {
    return {
      equipo: limpiar(form.querySelector('[data-field="equipo"]').value),
      jugadores: cards().map(getPlayer)
    };
  }

  function payloadIncluyeUsuario(data) {
    const userEmail = currentUserEmail();
    if (!userEmail) return true;
    return data.jugadores.some((player) => emailNormalizado(player.email || "") === emailNormalizado(userEmail));
  }

  function applyServerErrors(fields) {
    const loose = [];
    Object.entries(fields || {}).forEach(([key, message]) => {
      if (key === "equipo") {
        loose.push(message);
        return;
      }
      const match = key.match(/^jugadores\.(\d+)\.(\w+)$/);
      if (!match) {
        loose.push(message);
      }
    });
    return loose.join(" ");
  }

  async function loadTeam() {
    show("loading");
    try {
      const response = await fetch("/api/mi-equipo", {
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      if (response.status === 401) {
        show("empty");
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido cargar tu equipo.");
      if (!data.team) {
        show("empty");
        return;
      }
      renderTeam(data.team);
    } catch (err) {
      show("empty");
      setBanner(err instanceof Error ? err.message : "No se ha podido cargar tu equipo.");
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setBanner("");
    setBusy(true);
    const original = save.textContent;
    save.textContent = "Guardando...";

    try {
      const dataToSave = payload();
      if (!payloadIncluyeUsuario(dataToSave)) {
        throw new Error("Mantén tu correo de Google en uno de los jugadores para seguir gestionando este equipo.");
      }
      const response = await fetch("/api/mi-equipo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "include",
        body: JSON.stringify(dataToSave)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const details = applyServerErrors(data.campos);
        throw new Error([data.error || "No se ha podido guardar.", details].filter(Boolean).join(" "));
      }
      if (data.team) renderTeam(data.team);
      await window.CopaAuth?.refresh?.();
      setBanner("Equipo actualizado.", "ok");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "No se ha podido guardar.");
    } finally {
      save.textContent = original;
      setBusy(false);
    }
  });

  addPlayer.addEventListener("click", () => {
    createPlayer();
    const last = cards().at(-1);
    last?.querySelector("input")?.focus();
  });

  remove.addEventListener("click", async () => {
    const confirmed = window.confirm("¿Seguro que quieres borrar tu equipo? Podrás crear otro después.");
    if (!confirmed) return;

    setBusy(true);
    try {
      const response = await fetch("/api/mi-equipo", {
        method: "DELETE",
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido borrar tu equipo.");
      await window.CopaAuth?.refresh?.();
      show("empty");
    } catch (err) {
      setBanner(err instanceof Error ? err.message : "No se ha podido borrar tu equipo.");
    } finally {
      setBusy(false);
    }
  });

  window.addEventListener("copa:auth", (event) => {
    const detail = event.detail || {};
    if (detail.loading) {
      show("loading");
      return;
    }
    if (!detail.user || !detail.team) {
      show("empty");
      return;
    }
    loadTeam();
  });

  if (window.CopaAuth?.state) {
    const current = window.CopaAuth.state;
    if (!current.loading && current.user && current.team) {
      loadTeam();
    }
  }
})();
