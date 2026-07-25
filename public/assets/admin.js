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
  const normalize = root.querySelector("[data-admin-normalize]");
  const shirtForm = root.querySelector("[data-admin-shirt-form]");
  const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

  const teamEditDialog = document.querySelector("[data-team-edit-dialog]");
  const teamEditForm = teamEditDialog?.querySelector("[data-team-edit-form]");
  const teamEditPlayers = teamEditDialog?.querySelector("[data-team-edit-players]");
  const teamEditBanner = teamEditDialog?.querySelector("[data-team-edit-banner]");
  const teamEditTitle = teamEditDialog?.querySelector("[data-team-edit-title]");
  const teamEditAdd = teamEditDialog?.querySelector("[data-team-edit-add]");
  const teamEditDiff = teamEditDialog?.querySelector("[data-team-edit-diff]");
  const teamEditDiffList = teamEditDialog?.querySelector("[data-team-edit-diff-list]");
  const teamEditReview = teamEditDialog?.querySelector("[data-team-edit-review]");
  const teamEditBack = teamEditDialog?.querySelector("[data-team-edit-back]");
  const teamEditConfirm = teamEditDialog?.querySelector("[data-team-edit-confirm]");
  const teamEditTemplate = document.getElementById("team-edit-player-template");
  const MIN_JUGADORES = 2;
  const MAX_JUGADORES = 15;
  const MAX_FOTO_BYTES = 4 * 1024 * 1024;
  const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
  const NOMBRE_RE = /^[\p{L}\p{M}'’. -]+$/u;
  const EMAIL_RE = /^\S+@\S+\.\S+$/;
  const HANDLE_RE = /^@?[a-zA-Z0-9._]{2,30}$/;
  const URL_SOCIAL_RE = /^https:\/\/\S{5,110}$/;

  let equipoEnEdicion = null;

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
      head.append(editButton(() => openTeamEditDialog(team)));
      card.append(head);

      const players = el("div", "admin-sublist");
      (team.jugadores || []).forEach((player) => {
        const item = el("div", "admin-subitem");
        const head = el("div", "admin-subitem-head");
        if (player.tieneFoto) {
          const img = document.createElement("img");
          img.className = "admin-photo-thumb";
          img.alt = "";
          img.src = `/api/admin?type=foto&jugadorId=${encodeURIComponent(player.id)}`;
          head.append(img);
        } else {
          head.append(el("span", "admin-photo-thumb is-empty"));
        }
        const info = el("div", "");
        info.append(el("strong", "", `${player.nombre} ${player.apellidos}`));
        info.append(el("span", "", `${player.esSuplente ? "Suplente" : "Titular"} · ${text(player.telefono)} · ${text(player.email)}`));
        head.append(info);
        item.append(head);
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

  function editButton(onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "player-remove";
    button.textContent = "Editar";
    button.addEventListener("click", onClick);
    return button;
  }

  function crearFilaJugador(jugador) {
    const carta = teamEditTemplate.content.firstElementChild.cloneNode(true);
    if (jugador && jugador.id) carta.dataset.playerId = String(jugador.id);

    const setValor = (campo, valor) => {
      const input = carta.querySelector(`[data-field="${campo}"]`);
      if (input) input.value = valor || "";
    };
    setValor("nombre", jugador?.nombre);
    setValor("apellidos", jugador?.apellidos);
    setValor("telefono", jugador?.telefono);
    setValor("email", jugador?.email);
    setValor("redSocial", jugador?.redSocial);

    const preview = carta.querySelector("[data-photo-preview]");
    const empty = carta.querySelector("[data-photo-empty]");
    if (jugador?.tieneFoto && jugador?.id) {
      preview.src = `/api/admin?type=foto&jugadorId=${encodeURIComponent(jugador.id)}`;
      preview.hidden = false;
      empty.hidden = true;
      carta.dataset.tieneFotoOriginal = "1";
    } else {
      preview.hidden = true;
      empty.hidden = false;
      carta.dataset.tieneFotoOriginal = "";
    }

    carta.querySelector("[data-remove]").addEventListener("click", () => {
      carta.remove();
      reindexarEdicion();
    });
    carta.querySelector("[data-move-up]").addEventListener("click", () => moverJugador(carta, -1));
    carta.querySelector("[data-move-down]").addEventListener("click", () => moverJugador(carta, 1));

    carta.querySelectorAll("input[data-field]").forEach((input) => {
      if (input.dataset.field === "foto") return;
      input.addEventListener("blur", () => validarCampoEdicion(input));
    });

    const fotoInput = carta.querySelector('[data-field="foto"]');
    const eliminarFotoInput = carta.querySelector('[data-field="eliminarFoto"]');
    fotoInput.addEventListener("change", () => {
      const archivo = fotoInput.files && fotoInput.files[0];
      if (!archivo) return;
      if (archivo.size > MAX_FOTO_BYTES || !TIPOS_FOTO.includes(archivo.type)) {
        pintarErrorEdicion(carta, "foto", "Solo se admiten fotos JPG, PNG o WebP de hasta 4 MB.");
        fotoInput.value = "";
        return;
      }
      pintarErrorEdicion(carta, "foto", "");
      eliminarFotoInput.checked = false;
      if (preview.dataset.objectUrl === "1") {
        URL.revokeObjectURL(preview.src);
      }
      preview.src = URL.createObjectURL(archivo);
      preview.dataset.objectUrl = "1";
      preview.hidden = false;
      empty.hidden = true;
    });
    eliminarFotoInput.addEventListener("change", () => {
      if (eliminarFotoInput.checked) {
        fotoInput.value = "";
        preview.hidden = true;
        empty.hidden = false;
      } else if (carta.dataset.tieneFotoOriginal && !fotoInput.files?.[0]) {
        preview.hidden = false;
        empty.hidden = true;
      }
    });

    return carta;
  }

  function openTeamEditDialog(team) {
    if (!teamEditDialog) return;
    equipoEnEdicion = {
      id: team.id,
      nombre: team.nombre,
      jugadores: (team.jugadores || []).map((j) => ({ ...j }))
    };
    teamEditTitle.textContent = team.nombre;
    teamEditForm.querySelector('[data-team-edit-field="equipo"]').value = team.nombre;
    teamEditPlayers.innerHTML = "";
    (team.jugadores || []).forEach((jugador) => {
      teamEditPlayers.append(crearFilaJugador(jugador));
    });
    reindexarEdicion();
    mostrarPasoEdicion();
    limpiarBannerEdicion();
    teamEditDialog.showModal();
  }

  function reindexarEdicion() {
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    cartas.forEach((carta, i) => {
      carta.querySelector("[data-dorsal]").textContent = String(i + 1);
      carta.querySelector("[data-role]").textContent = i < MIN_JUGADORES ? "Titular" : "Suplente";
      carta.classList.toggle("is-suplente", i >= MIN_JUGADORES);
      carta.querySelector("[data-remove]").hidden = cartas.length <= MIN_JUGADORES;
      carta.querySelector("[data-move-up]").disabled = i === 0;
      carta.querySelector("[data-move-down]").disabled = i === cartas.length - 1;
    });
    teamEditAdd.disabled = cartas.length >= MAX_JUGADORES;
  }

  function moverJugador(carta, delta) {
    const hermano = delta < 0 ? carta.previousElementSibling : carta.nextElementSibling;
    if (!hermano) return;
    if (delta < 0) teamEditPlayers.insertBefore(carta, hermano);
    else teamEditPlayers.insertBefore(hermano, carta);
    reindexarEdicion();
  }

  function pintarErrorEdicion(carta, campo, mensaje) {
    const p = carta.querySelector(`[data-field-error="${campo}"]`);
    if (!p) return;
    p.textContent = mensaje || "";
    p.hidden = !mensaje;
  }

  function limpiarBannerEdicion() {
    teamEditBanner.textContent = "";
    teamEditBanner.hidden = true;
  }

  function mostrarPasoEdicion() {
    teamEditPlayers.hidden = false;
    teamEditAdd.hidden = false;
    teamEditDiff.hidden = true;
    teamEditReview.hidden = false;
    teamEditBack.hidden = true;
    teamEditConfirm.hidden = true;
  }

  function mensajeCampoEdicion(input) {
    const campo = input.dataset.field;
    const v = limpiar(input.value || "");
    switch (campo) {
      case "nombre":
        return v.length < 2 || v.length > 60 || !NOMBRE_RE.test(v)
          ? "Introduce el nombre (solo letras, entre 2 y 60 caracteres)."
          : "";
      case "apellidos":
        return v.length < 2 || v.length > 80 || !NOMBRE_RE.test(v)
          ? "Introduce los apellidos (solo letras, entre 2 y 80 caracteres)."
          : "";
      case "telefono":
        return !/^[67]\d{8}$/.test(v.replace(/\D/g, "").replace(/^34(?=\d{9}$)/, ""))
          ? "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
          : "";
      case "email":
        if (!v) return "El correo de cada jugador es obligatorio.";
        return !EMAIL_RE.test(v) || v.length > 120 ? "Ese correo no parece válido." : "";
      case "redSocial":
        return v && (v.length > 120 || !(HANDLE_RE.test(v) || URL_SOCIAL_RE.test(v)))
          ? "Usa un usuario tipo @nombre o un enlace https://."
          : "";
      default:
        return "";
    }
  }

  function validarCampoEdicion(input) {
    const carta = input.closest("[data-team-edit-player]");
    const mensaje = mensajeCampoEdicion(input);
    pintarErrorEdicion(carta, input.dataset.field, mensaje);
    return !mensaje;
  }

  function validarNombreEquipoEdicion() {
    const input = teamEditForm.querySelector('[data-team-edit-field="equipo"]');
    const v = limpiar(input.value || "");
    const mensaje = v.length < 2 || v.length > 60 ? "El nombre del equipo debe tener entre 2 y 60 caracteres." : "";
    const p = teamEditForm.querySelector('[data-team-edit-error="equipo"]');
    p.textContent = mensaje;
    p.hidden = !mensaje;
    return !mensaje;
  }

  function validarFormularioEdicion() {
    let valido = validarNombreEquipoEdicion();
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    cartas.forEach((carta) => {
      carta.querySelectorAll("input[data-field]").forEach((input) => {
        if (input.dataset.field === "foto" || input.dataset.field === "eliminarFoto") return;
        if (!validarCampoEdicion(input)) valido = false;
      });
    });
    return valido;
  }

  function etiquetaJugador(jugador) {
    const nombre = limpiar(jugador.nombre || "");
    const apellidos = limpiar(jugador.apellidos || "");
    return `${nombre} ${apellidos}`.trim() || "Jugador sin nombre";
  }

  function datosFilaEdicion(carta) {
    const valor = (campo) => {
      const input = carta.querySelector(`[data-field="${campo}"]`);
      return limpiar(input ? input.value : "");
    };
    const datos = {
      id: carta.dataset.playerId ? Number(carta.dataset.playerId) : undefined,
      nombre: valor("nombre"),
      apellidos: valor("apellidos"),
      telefono: valor("telefono"),
      email: valor("email"),
      redSocial: valor("redSocial"),
      eliminarFoto: carta.querySelector('[data-field="eliminarFoto"]').checked
    };
    const fotoInput = carta.querySelector('[data-field="foto"]');
    datos.fotoNueva = fotoInput.files && fotoInput.files[0] ? fotoInput.files[0] : null;
    return datos;
  }

  function calcularDiff() {
    const cambios = [];
    const nombreEquipoActual = limpiar(teamEditForm.querySelector('[data-team-edit-field="equipo"]').value);
    if (nombreEquipoActual !== equipoEnEdicion.nombre) {
      cambios.push(`Nombre del equipo: «${equipoEnEdicion.nombre}» → «${nombreEquipoActual}»`);
    }

    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    const idsActuales = new Set();
    const CAMPOS = [
      ["nombre", "Nombre"],
      ["apellidos", "Apellidos"],
      ["telefono", "Móvil"],
      ["email", "Correo"],
      ["redSocial", "Red social"]
    ];

    cartas.forEach((carta) => {
      const datos = datosFilaEdicion(carta);
      if (datos.id === undefined) {
        cambios.push(`Se añade a ${etiquetaJugador(datos)}.`);
      } else {
        idsActuales.add(datos.id);
        const original = equipoEnEdicion.jugadores.find((j) => j.id === datos.id);
        if (original) {
          CAMPOS.forEach(([campo, etiqueta]) => {
            const antes = limpiar(original[campo] || "");
            const despues = datos[campo] || "";
            if (antes !== despues) {
              cambios.push(`${etiquetaJugador(original)} — ${etiqueta}: «${antes || "—"}» → «${despues || "—"}»`);
            }
          });
          if (datos.fotoNueva) {
            cambios.push(`${etiquetaJugador(original)}: cambia la foto.`);
          } else if (datos.eliminarFoto && original.tieneFoto) {
            cambios.push(`${etiquetaJugador(original)}: se elimina la foto.`);
          }
        }
      }
    });

    equipoEnEdicion.jugadores.forEach((original) => {
      if (original.id && !idsActuales.has(original.id)) {
        cambios.push(`Se quita a ${etiquetaJugador(original)}.`);
      }
    });

    const ordenActual = cartas.map((carta) => carta.dataset.playerId ? Number(carta.dataset.playerId) : undefined)
      .filter((id) => id !== undefined && idsActuales.has(id));
    const ordenOriginal = equipoEnEdicion.jugadores
      .map((j) => j.id)
      .filter((id) => idsActuales.has(id));
    const ordenCambiado = ordenActual.length !== ordenOriginal.length
      || ordenActual.some((id, i) => id !== ordenOriginal[i]);
    if (ordenCambiado) {
      cambios.push("Cambia el orden de los jugadores (titulares/suplentes).");
    }

    return cambios;
  }

  function mostrarBannerEdicion(mensaje, kind = "error") {
    teamEditBanner.textContent = mensaje;
    teamEditBanner.dataset.kind = kind;
    teamEditBanner.hidden = !mensaje;
  }

  teamEditReview?.addEventListener("click", () => {
    limpiarBannerEdicion();
    if (!validarFormularioEdicion()) {
      mostrarBannerEdicion("Revisa los campos marcados.");
      return;
    }
    const cambios = calcularDiff();
    if (cambios.length === 0) {
      mostrarBannerEdicion("No hay cambios que guardar.");
      return;
    }
    teamEditDiffList.innerHTML = "";
    cambios.forEach((linea) => {
      const li = document.createElement("li");
      li.textContent = linea;
      teamEditDiffList.append(li);
    });
    teamEditPlayers.hidden = true;
    teamEditAdd.hidden = true;
    teamEditDiff.hidden = false;
    teamEditReview.hidden = true;
    teamEditBack.hidden = false;
    teamEditConfirm.hidden = false;
  });

  teamEditBack?.addEventListener("click", () => {
    mostrarPasoEdicion();
  });

  function pintarErroresServidorEdicion(campos) {
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    const sueltos = [];
    Object.entries(campos || {}).forEach(([clave, mensaje]) => {
      if (clave === "equipo") {
        const p = teamEditForm.querySelector('[data-team-edit-error="equipo"]');
        p.textContent = mensaje;
        p.hidden = false;
        return;
      }
      const partes = clave.match(/^jugadores\.(\d+)\.(\w+)$/);
      if (partes && cartas[Number(partes[1])]) {
        pintarErrorEdicion(cartas[Number(partes[1])], partes[2], mensaje);
        return;
      }
      sueltos.push(mensaje);
    });
    return sueltos;
  }

  teamEditConfirm?.addEventListener("click", async () => {
    const cartas = Array.from(teamEditPlayers.querySelectorAll("[data-team-edit-player]"));
    const jugadores = cartas.map((carta) => {
      const datos = datosFilaEdicion(carta);
      const jugador = {
        nombre: datos.nombre,
        apellidos: datos.apellidos,
        telefono: datos.telefono,
        eliminarFoto: datos.eliminarFoto
      };
      if (datos.id !== undefined) jugador.id = datos.id;
      if (datos.email) jugador.email = datos.email;
      if (datos.redSocial) jugador.redSocial = datos.redSocial;
      return jugador;
    });

    const payload = {
      nombre: limpiar(teamEditForm.querySelector('[data-team-edit-field="equipo"]').value),
      jugadores
    };

    const datosEnvio = new FormData();
    datosEnvio.append("payload", JSON.stringify(payload));
    cartas.forEach((carta, i) => {
      const fotoInput = carta.querySelector('[data-field="foto"]');
      if (fotoInput.files && fotoInput.files[0]) {
        datosEnvio.append(`foto_${i}`, fotoInput.files[0]);
      }
    });

    teamEditConfirm.disabled = true;
    teamEditConfirm.setAttribute("aria-busy", "true");
    const textoOriginal = teamEditConfirm.textContent;
    teamEditConfirm.textContent = "Guardando...";

    try {
      const respuesta = await fetch(`/api/admin?type=equipo&id=${encodeURIComponent(equipoEnEdicion.id)}`, {
        method: "PATCH",
        cache: "no-store",
        headers: { Accept: "application/json" },
        credentials: "include",
        body: datosEnvio
      });
      const cuerpo = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok || !cuerpo.ok) {
        mostrarPasoEdicion();
        const sueltos = cuerpo.campos ? pintarErroresServidorEdicion(cuerpo.campos) : [];
        mostrarBannerEdicion([cuerpo.error || "No se ha podido guardar el equipo.", ...sueltos].join(" "));
        return;
      }
      teamEditDialog.close();
      await loadAdmin();
    } catch {
      mostrarPasoEdicion();
      mostrarBannerEdicion("No hay conexión. Comprueba la red e inténtalo de nuevo.");
    } finally {
      teamEditConfirm.disabled = false;
      teamEditConfirm.removeAttribute("aria-busy");
      teamEditConfirm.textContent = textoOriginal;
    }
  });

  teamEditAdd?.addEventListener("click", () => {
    const carta = crearFilaJugador(null);
    teamEditPlayers.append(carta);
    reindexarEdicion();
    carta.querySelector('[data-field="nombre"]')?.focus();
  });

  teamEditDialog?.addEventListener("close", () => {
    equipoEnEdicion = null;
    teamEditPlayers.innerHTML = "";
  });

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

  async function normalizeNames() {
    if (!window.confirm("¿Normalizar mayúsculas y tildes en los nombres de todos los jugadores?")) return;
    try {
      const response = await fetch("/api/admin?type=normalizar-nombres", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido normalizar los nombres.");
      window.alert(`Nombres actualizados: ${data.actualizados}.`);
      await loadAdmin();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se ha podido normalizar los nombres.");
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
  normalize?.addEventListener("click", normalizeNames);
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
