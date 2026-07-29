(() => {
  const root = document.querySelector("[data-my-team]");
  if (!root) return;

  const loading = root.querySelector("[data-my-team-loading]");
  const empty = root.querySelector("[data-my-team-empty]");
  const cedido = root.querySelector("[data-my-team-cedido]");
  const editor = root.querySelector("[data-my-team-editor]");
  const form = root.querySelector("[data-my-team-form]");
  const banner = root.querySelector("[data-my-team-banner]");
  const players = root.querySelector("[data-my-team-players]");
  const addPlayer = root.querySelector("[data-my-team-add-player]");
  const save = root.querySelector("[data-my-team-save]");
  const remove = root.querySelector("[data-my-team-delete]");
  const titulo = root.querySelector("[data-my-team-titulo]");
  const intro = root.querySelector("[data-my-team-intro]");
  const avisoLectura = root.querySelector("[data-my-team-lectura]");
  const template = document.getElementById("my-team-player-template");

  const MIN_JUGADORES = 2;
  const MAX_JUGADORES = 15;
  const AVISO_SIN_MOVIL = "Sin móvil no le añadiremos al grupo del torneo.";
  const AVISO_SIN_CORREO = "Sin correo no recibirá los avisos del torneo.";
  const AVISO_SIN_CONTACTO =
    "Sin móvil ni correo no le añadiremos al grupo del torneo ni recibirá avisos.";
  const MENSAJE_CAPITAN_CONTACTO = "El capitán necesita móvil y correo para que podamos avisaros.";

  // Solo el propietario del equipo puede guardar; el resto de la plantilla lo
  // ve, pero el PATCH les respondería 403. Lo dice el servidor en cada carga.
  let soloLectura = false;

  // El capitán se guarda por elemento, no por índice: las tarjetas se añaden y
  // se quitan, y un índice se quedaría apuntando a otra persona.
  let cartaCapitan = null;
  // El id del capitán que vino del servidor: compararlo con `cartaCapitan`
  // dice si el guardado en curso es una cesión.
  let capitanOriginalId = null;

  const limpiar = (value) => String(value || "").trim().replace(/\s+/g, " ");
  const emailNormalizado = (value) => limpiar(value).toLowerCase();
  const cards = () => Array.from(players.querySelectorAll("[data-player]"));
  const currentUserEmail = () => window.CopaAuth?.state?.user?.email || "";
  const valorDe = (card, campo) => limpiar(card.querySelector(`[data-field="${campo}"]`)?.value || "");
  const tieneContacto = (card) => Boolean(valorDe(card, "telefono")) && Boolean(valorDe(card, "email"));

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

  /**
   * Modo lectura. Los botones se ocultan en vez de deshabilitarse: uno que nunca
   * se va a activar solo estorba. Los campos quedan readonly, no disabled, para
   * que los datos del equipo se puedan seguir seleccionando y copiando.
   */
  function aplicarPermisos() {
    if (titulo) titulo.textContent = soloLectura ? "Tu equipo" : "Editar inscripción";
    if (intro) intro.hidden = soloLectura;
    if (avisoLectura) avisoLectura.hidden = !soloLectura;
    addPlayer.hidden = soloLectura;
    save.hidden = soloLectura;
    remove.hidden = soloLectura;
    form.querySelectorAll("input").forEach((input) => {
      input.readOnly = soloLectura;
    });
  }

  function show(mode) {
    loading.hidden = mode !== "loading";
    empty.hidden = mode !== "empty";
    editor.hidden = mode !== "editor";
  }

  function createPlayer(data = {}) {
    const card = template.content.firstElementChild.cloneNode(true);
    // El id viaja en el guardado para que el servidor sepa quién sigue siendo
    // quién: sin él borraría y reinsertaría a todo el equipo, y sus fotos con él.
    if (data.id) card.dataset.playerId = String(data.id);
    card.querySelector('[data-field="nombre"]').value = data.nombre || "";
    card.querySelector('[data-field="apellidos"]').value = data.apellidos || "";
    card.querySelector('[data-field="telefono"]').value = data.telefono || "";
    card.querySelector('[data-field="email"]').value = data.email || "";
    card.querySelector('[data-field="redSocial"]').value = data.redSocial || "";
    card.querySelector("[data-remove]").addEventListener("click", () => {
      card.remove();
      if (cartaCapitan === card) cartaCapitan = null;
      reindex();
      actualizarCapitan();
    });
    card.querySelector("[data-make-capitan]").addEventListener("click", () => {
      if (soloLectura || !tieneContacto(card)) return;
      cartaCapitan = card;
      reindex();
      actualizarCapitan();
    });
    ["telefono", "email"].forEach((campo) => {
      card.querySelector(`[data-field="${campo}"]`).addEventListener("input", actualizarCapitan);
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
      card.querySelector("[data-remove]").hidden = soloLectura || index < MIN_JUGADORES;
    });
    addPlayer.disabled = list.length >= MAX_JUGADORES;
    addPlayer.textContent = list.length >= MAX_JUGADORES ? `Máximo ${MAX_JUGADORES} personas por equipo` : "+ Añadir suplente";
  }

  /** Aviso bajo la tarjeta: dice qué falta y qué implica. */
  function actualizarAviso(card) {
    const aviso = card.querySelector("[data-contacto-aviso]");
    if (!aviso) return;
    if (soloLectura || card === cartaCapitan) {
      aviso.hidden = true;
      return;
    }
    const sinMovil = !valorDe(card, "telefono");
    const sinCorreo = !valorDe(card, "email");
    const mensaje = sinMovil && sinCorreo
      ? AVISO_SIN_CONTACTO
      : sinMovil
        ? AVISO_SIN_MOVIL
        : sinCorreo
          ? AVISO_SIN_CORREO
          : "";
    aviso.textContent = mensaje;
    aviso.hidden = !mensaje;
  }

  /** Insignia, botón de cesión, rótulos opcionales y aviso de cada tarjeta. */
  function actualizarCapitan() {
    const list = cards();
    if (!list.includes(cartaCapitan)) cartaCapitan = list[0] || null;

    list.forEach((card) => {
      const esCapitan = card === cartaCapitan;
      card.classList.toggle("is-capitan", esCapitan);
      card.querySelector("[data-capitan-badge]").hidden = !esCapitan;

      const boton = card.querySelector("[data-make-capitan]");
      boton.hidden = soloLectura || esCapitan;
      boton.disabled = !tieneContacto(card);
      boton.title = boton.disabled ? "Necesita móvil y correo para ser capitán." : "";

      card.querySelector('[data-opt="telefono"]').hidden = esCapitan;
      card.querySelector('[data-opt="email"]').hidden = esCapitan;

      // Al capitán no se le quita de la plantilla: primero se cede el mando.
      // Esto va aquí y no en reindex() porque depende de quién manda, y
      // `actualizarCapitan` siempre corre después de `reindex`.
      if (esCapitan) card.querySelector("[data-remove]").hidden = true;

      actualizarAviso(card);
    });
  }

  function renderTeam(team) {
    soloLectura = team.puedeEditar === false;
    form.querySelector('[data-field="equipo"]').value = team.nombre || "";

    const figura = root.querySelector("[data-my-team-foto]");
    if (figura) {
      const img = figura.querySelector("[data-my-team-foto-img]");
      if (team.tieneFoto && team.id) {
        img.src = `/api/equipos?foto=${encodeURIComponent(team.id)}`;
        img.alt = `Foto del equipo ${team.nombre || ""}`.trim();
        figura.hidden = false;
      } else {
        figura.hidden = true;
      }
    }

    players.textContent = "";
    cartaCapitan = null;
    const jugadores = Array.isArray(team.jugadores) ? team.jugadores : [];
    jugadores.forEach((player) => createPlayer(player));
    // El capitán viene del servidor por id de jugador; si el equipo aún no
    // tiene (heredado o creado en el panel), manda el primero de la lista.
    capitanOriginalId = team.capitanJugadorId ?? null;
    cartaCapitan =
      cards().find((card) => Number(card.dataset.playerId) === capitanOriginalId) || cards()[0] || null;
    // Las fichas vacías de relleno solo tienen sentido si se pueden rellenar.
    if (!soloLectura) while (cards().length < MIN_JUGADORES) createPlayer();
    actualizarCapitan();
    aplicarPermisos();
    setBanner("");
    show("editor");
  }

  function getPlayer(card) {
    const value = (field) => limpiar(card.querySelector(`[data-field="${field}"]`)?.value);
    const player = { nombre: value("nombre"), apellidos: value("apellidos") };
    if (card.dataset.playerId) player.id = Number(card.dataset.playerId);
    const telefono = value("telefono");
    if (telefono) player.telefono = telefono;
    const email = value("email");
    const redSocial = value("redSocial");
    if (email) player.email = email;
    if (redSocial) player.redSocial = redSocial;
    return player;
  }

  function payload() {
    return {
      equipo: limpiar(form.querySelector('[data-field="equipo"]').value),
      capitan: cards().indexOf(cartaCapitan),
      jugadores: cards().map(getPlayer)
    };
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
    const dataToSave = payload();
    const userEmail = currentUserEmail();
    const capitan = dataToSave.jugadores[dataToSave.capitan];
    if (!capitan || !capitan.telefono || !capitan.email) {
      setBanner(MENSAJE_CAPITAN_CONTACTO);
      return;
    }
    if (!userEmail) {
      setBanner("Inicia sesión para guardar los cambios de tu equipo.");
      return;
    }

    // Ceder es entregar el equipo entero: quien entre con ese correo pasa a
    // mandar y quien lo cede deja de poder guardar. Se pide a propósito.
    const cede =
      capitanOriginalId !== null && Number(cartaCapitan?.dataset.playerId || 0) !== capitanOriginalId;
    if (cede) {
      const aviso =
        `Vas a nombrar capitán a ${capitan.nombre} ${capitan.apellidos}. ` +
        `Dejarás de poder editar el equipo: a partir de ahora lo hará quien entre con ${capitan.email}. ` +
        "Si ese correo no es una cuenta de Google, nadie podrá editarlo hasta que os echemos una mano. ¿Seguimos?";
      if (!window.confirm(aviso)) return;
    }
    setBusy(true);
    const original = save.textContent;
    save.textContent = "Guardando...";

    try {
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
      if (data.team) {
        renderTeam(data.team);
      } else {
        // Si el guardado deja al usuario fuera del equipo (cesión a otra
        // persona), el editor queda oculto y con él el banner: el aviso hay
        // que pintarlo en el bloque vacío, que es lo único que se ve.
        show("empty");
        if (cedido) {
          cedido.textContent = "Has cedido el equipo. Ya no formas parte de la plantilla.";
          cedido.hidden = false;
        }
      }
      await window.CopaAuth?.refresh?.();
      setBanner(data.team ? "Equipo actualizado." : "", "ok");
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
