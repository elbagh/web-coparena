/*
 * /admin/equipos/ — tabla de equipos y editor completo del equipo.
 *
 * El editor conserva su paso de revisión: antes de guardar enseña en prosa qué
 * va a cambiar. Es la operación más destructiva del panel (reordenar cambia
 * quién es titular, quitar a alguien borra su foto de R2) y el resumen es la
 * red de seguridad.
 *
 * La validación por campo replica functions/_lib/validacion.ts: si cambia una,
 * hay que cambiar la otra.
 */
(() => {
  const raiz = document.querySelector("[data-admin-equipos]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, apiJson, resumen, onReady, recargar, setError, el, clear, text, tabla, celda, boton, enlace, limpiar, confirmar } =
    window.CopaAdmin;

  const buscador = document.querySelector("[data-admin-buscar]");
  const contador = document.querySelector("[data-admin-contador]");
  const normalizar = document.querySelector("[data-admin-normalize]");
  const btnNuevo = document.querySelector("[data-equipo-nuevo]");
  const dialogoNuevo = document.querySelector("[data-equipo-nuevo-dialog]");

  const fotoEquipoInput = () => dialogo?.querySelector('[data-team-edit-field="fotoEquipo"]');
  const eliminarFotoEquipo = () => dialogo?.querySelector('[data-team-edit-field="eliminarFotoEquipo"]');
  const fotoEquipoPreview = () => dialogo?.querySelector("[data-team-foto-preview]");
  const fotoEquipoVacia = () => dialogo?.querySelector("[data-team-foto-vacia]");

  const dialogo = document.querySelector("[data-team-edit-dialog]");
  const form = dialogo?.querySelector("[data-team-edit-form]");
  const listaJugadores = dialogo?.querySelector("[data-team-edit-players]");
  const banner = dialogo?.querySelector("[data-team-edit-banner]");
  const titulo = dialogo?.querySelector("[data-team-edit-title]");
  const anadir = dialogo?.querySelector("[data-team-edit-add]");
  const diff = dialogo?.querySelector("[data-team-edit-diff]");
  const diffList = dialogo?.querySelector("[data-team-edit-diff-list]");
  const btnRevisar = dialogo?.querySelector("[data-team-edit-review]");
  const btnVolver = dialogo?.querySelector("[data-team-edit-back]");
  const btnConfirmar = dialogo?.querySelector("[data-team-edit-confirm]");
  const btnCerrar = dialogo?.querySelector("[data-team-edit-close]");
  const plantilla = document.getElementById("team-edit-player-template");

  const MIN_JUGADORES = 2;
  const MAX_JUGADORES = 15;
  const MAX_FOTO_BYTES = 4 * 1024 * 1024;
  const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
  const NOMBRE_RE = /^[\p{L}\p{M}'’. -]+$/u;
  const EMAIL_RE = /^\S+@\S+\.\S+$/;
  const MENSAJE_CAPITAN_CONTACTO = "El capitán necesita móvil y correo para que podamos avisaros.";
  const HANDLE_RE = /^@?[a-zA-Z0-9._]{2,30}$/;
  const URL_SOCIAL_RE = /^https:\/\/\S{5,110}$/;

  let equipos = [];
  let equipoEnEdicion = null;

  const fotoJugador = (id) => `/api/admin/fotos?jugador=${encodeURIComponent(id)}`;

  // ------------------------------------------------------------- listado ---

  onReady(async () => {
    const datos = await resumen();
    equipos = Array.isArray(datos.equipos) ? datos.equipos : [];
    pintar();
  });

  function pintar() {
    const filtro = limpiar(buscador?.value || "").toLowerCase();
    const visibles = filtro
      ? equipos.filter((equipo) => textoBuscable(equipo).includes(filtro))
      : equipos;

    if (contador) {
      contador.textContent =
        visibles.length === equipos.length
          ? `${equipos.length} equipos`
          : `${visibles.length} de ${equipos.length} equipos`;
    }

    clear(raiz);
    raiz.append(
      tabla({
        vacio: filtro ? "Ningún equipo coincide con la búsqueda." : "Todavía no hay equipos registrados.",
        filas: visibles,
        columnas: [
          { etiqueta: "#", clase: "is-num is-shrink", render: (e) => String(e.id) },
          {
            etiqueta: "Equipo",
            clase: "is-strong",
            render: (e) => e.nombre
          },
          {
            etiqueta: "Jugadores",
            clase: "is-num is-shrink",
            render: (e) => String(e.jugadoresTotal || 0)
          },
          {
            etiqueta: "Plantilla",
            render: (e) => resumenPlantilla(e)
          },
          { etiqueta: "Capitán", clase: "is-clip", render: (e) => text(e.capitanEmail) },
          {
            etiqueta: "Acciones",
            clase: "is-actions",
            render: (e) =>
              celda(
                "admin-row-actions",
                enlace("Jugadores", `/admin/jugadores/?equipo=${encodeURIComponent(e.id)}`, "admin-btn admin-btn--sm"),
                boton("Editar", () => abrirEditor(e)),
                boton("Borrar", () => borrarEquipo(e), "admin-btn admin-btn--sm admin-btn--danger")
              )
          }
        ]
      })
    );
  }

  function textoBuscable(equipo) {
    const jugadores = (equipo.jugadores || [])
      .map((j) => `${j.nombre} ${j.apellidos} ${j.email || ""} ${j.telefono || ""}`)
      .join(" ");
    return `${equipo.nombre} ${equipo.capitanEmail || ""} ${jugadores}`.toLowerCase();
  }

  /** Miniaturas + nombres, para reconocer el equipo sin abrir la ficha. */
  function resumenPlantilla(equipo) {
    const jugadores = equipo.jugadores || [];
    if (jugadores.length === 0) return el("span", "admin-tag admin-tag--warn", "Sin jugadores");

    const caja = el("div", "admin-cell-media");
    if (equipo.tieneFoto) {
      const grupo = document.createElement("img");
      grupo.className = "admin-thumb";
      grupo.alt = "";
      grupo.title = "Foto de equipo";
      grupo.loading = "lazy";
      grupo.src = `/api/equipos?foto=${encodeURIComponent(equipo.id)}`;
      caja.append(grupo);
    }
    jugadores.slice(0, 4).forEach((jugador) => {
      if (jugador.tieneFoto) {
        const img = document.createElement("img");
        img.className = "admin-thumb";
        img.alt = "";
        img.loading = "lazy";
        img.src = fotoJugador(jugador.id);
        caja.append(img);
      } else {
        caja.append(el("span", "admin-thumb is-empty"));
      }
    });
    const nombres = jugadores.map((j) => `${j.nombre} ${j.apellidos}`).join(", ");
    const texto = el("span", "is-clip", nombres);
    texto.title = nombres;
    caja.append(texto);
    return caja;
  }

  buscador?.addEventListener("input", pintar);

  // ------------------------------------------------------------- borrado ---

  async function borrarEquipo(equipo) {
    const ok = await confirmar({
      titulo: "Borrar equipo",
      texto: `Se va a borrar «${equipo.nombre}».`,
      aviso: `Se borran también sus ${equipo.jugadoresTotal || 0} jugadores y las fotos que hayan subido. No se puede deshacer.`,
      accion: "Borrar equipo"
    });
    if (!ok) return;

    try {
      await api(`/api/admin/equipos?id=${encodeURIComponent(equipo.id)}`, { method: "DELETE" });
      await window.CopaAuth?.refresh?.();
      await recargar();
    } catch (err) {
      setError(err.message);
    }
  }

  // ------------------------------------------------ normalizar nombres ---

  normalizar?.addEventListener("click", async () => {
    const ok = await confirmar({
      titulo: "Normalizar nombres",
      texto: "Se van a recapitalizar el nombre y los apellidos de todos los jugadores.",
      aviso: "Afecta a todas las ediciones, no solo a la actual.",
      accion: "Normalizar"
    });
    if (!ok) return;

    try {
      const datos = await api("/api/admin/jugadores?accion=normalizar-nombres", { method: "POST" });
      await recargar();
      setError("");
      if (contador) contador.textContent = `${datos.actualizados} nombres actualizados`;
    } catch (err) {
      setError(err.message);
    }
  });

  // -------------------------------------------------------------- editor ---

  function crearFilaJugador(jugador) {
    const carta = plantilla.content.firstElementChild.cloneNode(true);
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

    const radio = carta.querySelector("[data-capitan-radio]");
    radio.checked = Boolean(jugador) && jugador.id === equipoEnEdicion?.capitanJugadorId;
    const refrescarRadio = () => {
      const completo =
        Boolean(limpiar(carta.querySelector('[data-field="telefono"]').value)) &&
        Boolean(limpiar(carta.querySelector('[data-field="email"]').value));
      radio.disabled = !completo;
      radio.title = completo ? "" : "Necesita móvil y correo para ser capitán.";
      if (!completo) radio.checked = false;
    };
    ["telefono", "email"].forEach((campo) =>
      carta.querySelector(`[data-field="${campo}"]`).addEventListener("input", refrescarRadio)
    );
    refrescarRadio();

    const preview = carta.querySelector("[data-photo-preview]");
    const vacia = carta.querySelector("[data-photo-empty]");
    if (jugador?.tieneFoto && jugador?.id) {
      preview.src = fotoJugador(jugador.id);
      preview.hidden = false;
      vacia.hidden = true;
      carta.dataset.tieneFotoOriginal = "1";
    } else {
      preview.hidden = true;
      vacia.hidden = false;
      carta.dataset.tieneFotoOriginal = "";
    }

    carta.querySelector("[data-remove]").addEventListener("click", () => {
      carta.remove();
      reindexar();
    });
    carta.querySelector("[data-move-up]").addEventListener("click", () => mover(carta, -1));
    carta.querySelector("[data-move-down]").addEventListener("click", () => mover(carta, 1));

    carta.querySelectorAll("input[data-field]").forEach((input) => {
      if (input.dataset.field === "foto") return;
      input.addEventListener("blur", () => validarCampo(input));
    });

    const fotoInput = carta.querySelector('[data-field="foto"]');
    const eliminarFoto = carta.querySelector('[data-field="eliminarFoto"]');
    fotoInput.addEventListener("change", () => {
      const archivo = fotoInput.files && fotoInput.files[0];
      if (!archivo) return;
      if (archivo.size > MAX_FOTO_BYTES || !TIPOS_FOTO.includes(archivo.type)) {
        pintarError(carta, "foto", "Solo se admiten fotos JPG, PNG o WebP de hasta 4 MB.");
        fotoInput.value = "";
        return;
      }
      pintarError(carta, "foto", "");
      eliminarFoto.checked = false;
      if (preview.dataset.objectUrl === "1") URL.revokeObjectURL(preview.src);
      preview.src = URL.createObjectURL(archivo);
      preview.dataset.objectUrl = "1";
      preview.hidden = false;
      vacia.hidden = true;
    });
    eliminarFoto.addEventListener("change", () => {
      if (eliminarFoto.checked) {
        fotoInput.value = "";
        preview.hidden = true;
        vacia.hidden = false;
      } else if (carta.dataset.tieneFotoOriginal && !fotoInput.files?.[0]) {
        preview.hidden = false;
        vacia.hidden = true;
      }
    });

    return carta;
  }

  function abrirEditor(equipo) {
    if (!dialogo) return;
    equipoEnEdicion = {
      id: equipo.id,
      nombre: equipo.nombre,
      tieneFoto: Boolean(equipo.tieneFoto),
      capitanJugadorId: equipo.capitanJugadorId ?? null,
      jugadores: (equipo.jugadores || []).map((j) => ({ ...j }))
    };
    titulo.textContent = equipo.nombre;
    form.querySelector('[data-team-edit-field="equipo"]').value = equipo.nombre;
    listaJugadores.innerHTML = "";
    (equipo.jugadores || []).forEach((jugador) => listaJugadores.append(crearFilaJugador(jugador)));
    prepararFotoEquipo(equipo);
    reindexar();
    mostrarPasoEdicion();
    limpiarBanner();
    dialogo.showModal();
  }

  // ------------------------------------------------------ foto de equipo ---

  function prepararFotoEquipo(equipo) {
    const input = fotoEquipoInput();
    const borrar = eliminarFotoEquipo();
    const preview = fotoEquipoPreview();
    const vacia = fotoEquipoVacia();
    if (!input) return;

    input.value = "";
    borrar.checked = false;
    liberarFotoEquipo();

    if (equipo.tieneFoto) {
      preview.src = `/api/equipos?foto=${encodeURIComponent(equipo.id)}&t=${Date.now()}`;
      preview.hidden = false;
      vacia.hidden = true;
    } else {
      preview.hidden = true;
      vacia.hidden = false;
    }
    errorFotoEquipo("");
  }

  /** El error de la foto de equipo no cuelga de ninguna carta de jugador. */
  function errorFotoEquipo(mensaje) {
    const p = form.querySelector('[data-team-edit-error="fotoEquipo"]');
    if (!p) return;
    p.textContent = mensaje || "";
    p.hidden = !mensaje;
  }

  function liberarFotoEquipo() {
    const preview = fotoEquipoPreview();
    if (preview?.dataset.objectUrl === "1") {
      URL.revokeObjectURL(preview.src);
      delete preview.dataset.objectUrl;
    }
  }

  fotoEquipoInput()?.addEventListener("change", () => {
    const archivo = fotoEquipoInput().files?.[0];
    if (!archivo) return;
    if (archivo.size > MAX_FOTO_BYTES || !TIPOS_FOTO.includes(archivo.type)) {
      errorFotoEquipo("Solo se admiten fotos JPG, PNG o WebP de hasta 4 MB.");
      fotoEquipoInput().value = "";
      return;
    }
    errorFotoEquipo("");
    eliminarFotoEquipo().checked = false;
    liberarFotoEquipo();
    const preview = fotoEquipoPreview();
    preview.src = URL.createObjectURL(archivo);
    preview.dataset.objectUrl = "1";
    preview.hidden = false;
    fotoEquipoVacia().hidden = true;
  });

  eliminarFotoEquipo()?.addEventListener("change", () => {
    const preview = fotoEquipoPreview();
    if (eliminarFotoEquipo().checked) {
      fotoEquipoInput().value = "";
      liberarFotoEquipo();
      preview.hidden = true;
      fotoEquipoVacia().hidden = false;
    } else if (equipoEnEdicion?.tieneFoto) {
      preview.src = `/api/equipos?foto=${encodeURIComponent(equipoEnEdicion.id)}&t=${Date.now()}`;
      preview.hidden = false;
      fotoEquipoVacia().hidden = true;
    }
  });

  function reindexar() {
    const cartas = Array.from(listaJugadores.querySelectorAll("[data-team-edit-player]"));
    cartas.forEach((carta, i) => {
      carta.querySelector("[data-dorsal]").textContent = String(i + 1);
      carta.querySelector("[data-role]").textContent = i < MIN_JUGADORES ? "Titular" : "Suplente";
      carta.classList.toggle("is-suplente", i >= MIN_JUGADORES);
      carta.querySelector("[data-remove]").hidden = cartas.length <= MIN_JUGADORES;
      carta.querySelector("[data-move-up]").disabled = i === 0;
      carta.querySelector("[data-move-down]").disabled = i === cartas.length - 1;
    });
    anadir.disabled = cartas.length >= MAX_JUGADORES;
  }

  function mover(carta, delta) {
    const hermano = delta < 0 ? carta.previousElementSibling : carta.nextElementSibling;
    if (!hermano) return;
    if (delta < 0) listaJugadores.insertBefore(carta, hermano);
    else listaJugadores.insertBefore(hermano, carta);
    reindexar();
  }

  function pintarError(carta, campo, mensaje) {
    const p = carta.querySelector(`[data-field-error="${campo}"]`);
    if (!p) return;
    p.textContent = mensaje || "";
    p.hidden = !mensaje;
  }

  function limpiarBanner() {
    banner.textContent = "";
    banner.hidden = true;
  }

  function mostrarBanner(mensaje) {
    banner.textContent = mensaje;
    banner.hidden = !mensaje;
  }

  function mostrarPasoEdicion() {
    listaJugadores.hidden = false;
    anadir.hidden = false;
    diff.hidden = true;
    btnRevisar.hidden = false;
    btnVolver.hidden = true;
    btnConfirmar.hidden = true;
  }

  function mensajeCampo(input) {
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
      case "telefono": {
        if (!v) return esFilaCapitana(input) ? MENSAJE_CAPITAN_CONTACTO : "";
        return !/^[67]\d{8}$/.test(v.replace(/\D/g, "").replace(/^34(?=\d{9}$)/, ""))
          ? "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
          : "";
      }
      case "email": {
        if (!v) return esFilaCapitana(input) ? MENSAJE_CAPITAN_CONTACTO : "";
        return !EMAIL_RE.test(v) || v.length > 120 ? "Ese correo no parece válido." : "";
      }
      case "redSocial":
        return v && (v.length > 120 || !(HANDLE_RE.test(v) || URL_SOCIAL_RE.test(v)))
          ? "Usa un usuario tipo @nombre o un enlace https://."
          : "";
      default:
        return "";
    }
  }

  const esFilaCapitana = (input) =>
    input.closest("[data-team-edit-player]")?.querySelector("[data-capitan-radio]")?.checked === true;

  function validarCampo(input) {
    const carta = input.closest("[data-team-edit-player]");
    const mensaje = mensajeCampo(input);
    pintarError(carta, input.dataset.field, mensaje);
    return !mensaje;
  }

  function validarNombreEquipo() {
    const input = form.querySelector('[data-team-edit-field="equipo"]');
    const v = limpiar(input.value || "");
    const mensaje = v.length < 2 || v.length > 60 ? "El nombre del equipo debe tener entre 2 y 60 caracteres." : "";
    const p = form.querySelector('[data-team-edit-error="equipo"]');
    p.textContent = mensaje;
    p.hidden = !mensaje;
    return !mensaje;
  }

  function validarFormulario() {
    let valido = validarNombreEquipo();
    Array.from(listaJugadores.querySelectorAll("[data-team-edit-player]")).forEach((carta) => {
      carta.querySelectorAll("input[data-field]").forEach((input) => {
        if (input.dataset.field === "foto" || input.dataset.field === "eliminarFoto") return;
        if (!validarCampo(input)) valido = false;
      });
    });

    const hayCapitan = Array.from(listaJugadores.querySelectorAll("[data-capitan-radio]")).some((r) => r.checked);
    if (!hayCapitan) {
      mostrarBanner("Marca quién es el capitán del equipo.");
      valido = false;
    }

    return valido;
  }

  const etiquetaJugador = (jugador) =>
    `${limpiar(jugador.nombre || "")} ${limpiar(jugador.apellidos || "")}`.trim() || "Jugador sin nombre";

  function datosFila(carta) {
    const valor = (campo) => {
      const input = carta.querySelector(`[data-field="${campo}"]`);
      return limpiar(input ? input.value : "");
    };
    const fotoInput = carta.querySelector('[data-field="foto"]');
    return {
      id: carta.dataset.playerId ? Number(carta.dataset.playerId) : undefined,
      nombre: valor("nombre"),
      apellidos: valor("apellidos"),
      telefono: valor("telefono"),
      email: valor("email"),
      redSocial: valor("redSocial"),
      eliminarFoto: carta.querySelector('[data-field="eliminarFoto"]').checked,
      fotoNueva: fotoInput.files && fotoInput.files[0] ? fotoInput.files[0] : null
    };
  }

  function calcularDiff() {
    const cambios = [];
    const nombreActual = limpiar(form.querySelector('[data-team-edit-field="equipo"]').value);
    if (nombreActual !== equipoEnEdicion.nombre) {
      cambios.push(`Nombre del equipo: «${equipoEnEdicion.nombre}» → «${nombreActual}»`);
    }

    if (fotoEquipoInput()?.files?.[0]) {
      cambios.push(equipoEnEdicion.tieneFoto ? "Cambia la foto del equipo." : "Se añade la foto del equipo.");
    } else if (eliminarFotoEquipo()?.checked && equipoEnEdicion.tieneFoto) {
      cambios.push("Se elimina la foto del equipo.");
    }

    const cartas = Array.from(listaJugadores.querySelectorAll("[data-team-edit-player]"));
    const idsActuales = new Set();
    const CAMPOS = [
      ["nombre", "Nombre"],
      ["apellidos", "Apellidos"],
      ["telefono", "Móvil"],
      ["email", "Correo"],
      ["redSocial", "Red social"]
    ];

    cartas.forEach((carta) => {
      const datos = datosFila(carta);
      if (datos.id === undefined) {
        cambios.push(`Se añade a ${etiquetaJugador(datos)}.`);
        return;
      }
      idsActuales.add(datos.id);
      const original = equipoEnEdicion.jugadores.find((j) => j.id === datos.id);
      if (!original) return;

      CAMPOS.forEach(([campo, nombre]) => {
        const antes = limpiar(original[campo] || "");
        const despues = datos[campo] || "";
        if (antes !== despues) {
          cambios.push(`${etiquetaJugador(original)} — ${nombre}: «${antes || "—"}» → «${despues || "—"}»`);
        }
      });
      if (datos.fotoNueva) cambios.push(`${etiquetaJugador(original)}: cambia la foto.`);
      else if (datos.eliminarFoto && original.tieneFoto) cambios.push(`${etiquetaJugador(original)}: se elimina la foto.`);
    });

    equipoEnEdicion.jugadores.forEach((original) => {
      if (original.id && !idsActuales.has(original.id)) {
        cambios.push(`Se quita a ${etiquetaJugador(original)}.`);
      }
    });

    const ordenActual = cartas
      .map((carta) => (carta.dataset.playerId ? Number(carta.dataset.playerId) : undefined))
      .filter((id) => id !== undefined && idsActuales.has(id));
    const ordenOriginal = equipoEnEdicion.jugadores.map((j) => j.id).filter((id) => idsActuales.has(id));
    const ordenCambiado =
      ordenActual.length !== ordenOriginal.length || ordenActual.some((id, i) => id !== ordenOriginal[i]);
    if (ordenCambiado) cambios.push("Cambia el orden de los jugadores (titulares/suplentes).");

    const cartaCapitan = cartas.find((carta) => carta.querySelector("[data-capitan-radio]").checked);
    const idCapitan = cartaCapitan?.dataset.playerId ? Number(cartaCapitan.dataset.playerId) : undefined;
    if (idCapitan !== equipoEnEdicion.capitanJugadorId) {
      const antes = equipoEnEdicion.jugadores.find((j) => j.id === equipoEnEdicion.capitanJugadorId);
      cambios.push(
        `Capitán: ${antes ? etiquetaJugador(antes) : "—"} → ${cartaCapitan ? etiquetaJugador(datosFila(cartaCapitan)) : "—"}.`
      );
    }

    return cambios;
  }

  btnRevisar?.addEventListener("click", () => {
    limpiarBanner();
    if (!validarFormulario()) {
      // validarFormulario ya deja un mensaje más concreto en el banner
      // (por ejemplo, que falta marcar capitán); no lo pisamos.
      if (banner.hidden) mostrarBanner("Revisa los campos marcados.");
      return;
    }
    const cambios = calcularDiff();
    if (cambios.length === 0) {
      mostrarBanner("No hay cambios que guardar.");
      return;
    }
    diffList.innerHTML = "";
    cambios.forEach((linea) => {
      const li = document.createElement("li");
      li.textContent = linea;
      diffList.append(li);
    });
    listaJugadores.hidden = true;
    anadir.hidden = true;
    diff.hidden = false;
    btnRevisar.hidden = true;
    btnVolver.hidden = false;
    btnConfirmar.hidden = false;
  });

  btnVolver?.addEventListener("click", mostrarPasoEdicion);
  btnCerrar?.addEventListener("click", () => dialogo.close());

  /** Devuelve los mensajes que no se han podido anclar a ningún campo. */
  function pintarErroresServidor(campos) {
    const cartas = Array.from(listaJugadores.querySelectorAll("[data-team-edit-player]"));
    const sueltos = [];
    Object.entries(campos || {}).forEach(([clave, mensaje]) => {
      if (clave === "equipo") {
        const p = form.querySelector('[data-team-edit-error="equipo"]');
        p.textContent = mensaje;
        p.hidden = false;
        return;
      }
      const partes = clave.match(/^jugadores\.(\d+)\.(\w+)$/);
      if (partes && cartas[Number(partes[1])]) {
        pintarError(cartas[Number(partes[1])], partes[2], mensaje);
        return;
      }
      sueltos.push(mensaje);
    });
    return sueltos;
  }

  btnConfirmar?.addEventListener("click", async () => {
    const cartas = Array.from(listaJugadores.querySelectorAll("[data-team-edit-player]"));
    const jugadores = cartas.map((carta) => {
      const datos = datosFila(carta);
      const jugador = { nombre: datos.nombre, apellidos: datos.apellidos, eliminarFoto: datos.eliminarFoto };
      if (datos.id !== undefined) jugador.id = datos.id;
      if (datos.telefono) jugador.telefono = datos.telefono;
      if (datos.email) jugador.email = datos.email;
      if (datos.redSocial) jugador.redSocial = datos.redSocial;
      return jugador;
    });
    const indiceCapitan = cartas.findIndex((carta) => carta.querySelector("[data-capitan-radio]").checked);

    const envio = new FormData();
    // La clave es `equipo`, no `nombre`: es la que lee validarRegistro() en
    // functions/_lib/validacion.ts, igual que hacen /inscripcion/ y /mi-equipo/.
    envio.append(
      "payload",
      JSON.stringify({
        equipo: limpiar(form.querySelector('[data-team-edit-field="equipo"]').value),
        capitan: indiceCapitan,
        jugadores
      })
    );
    cartas.forEach((carta, i) => {
      const fotoInput = carta.querySelector('[data-field="foto"]');
      if (fotoInput.files && fotoInput.files[0]) envio.append(`foto_${i}`, fotoInput.files[0]);
    });

    const fotoEquipo = fotoEquipoInput()?.files?.[0];
    if (fotoEquipo) envio.append("fotoEquipo", fotoEquipo);
    if (eliminarFotoEquipo()?.checked) envio.append("eliminarFotoEquipo", "1");

    btnConfirmar.disabled = true;
    btnConfirmar.setAttribute("aria-busy", "true");
    const textoOriginal = btnConfirmar.textContent;
    btnConfirmar.textContent = "Guardando…";

    try {
      await api(`/api/admin/equipos?id=${encodeURIComponent(equipoEnEdicion.id)}`, {
        method: "PATCH",
        body: envio
      });
      dialogo.close();
      await recargar();
    } catch (err) {
      mostrarPasoEdicion();
      const sueltos = err.campos ? pintarErroresServidor(err.campos) : [];
      mostrarBanner([err.message, ...sueltos].join(" "));
    } finally {
      btnConfirmar.disabled = false;
      btnConfirmar.removeAttribute("aria-busy");
      btnConfirmar.textContent = textoOriginal;
    }
  });

  anadir?.addEventListener("click", () => {
    const carta = crearFilaJugador(null);
    listaJugadores.append(carta);
    reindexar();
    carta.querySelector('[data-field="nombre"]')?.focus();
  });

  // ------------------------------------------------------- alta de equipo ---

  btnNuevo?.addEventListener("click", () => {
    if (!dialogoNuevo) return;
    dialogoNuevo.querySelector("[data-equipo-nuevo-form]").reset();
    bannerNuevo("");
    errorNuevo("");
    dialogoNuevo.showModal();
    dialogoNuevo.querySelector('[data-equipo-nuevo-field="nombre"]').focus();
  });

  function bannerNuevo(mensaje) {
    const b = dialogoNuevo?.querySelector("[data-equipo-nuevo-banner]");
    if (!b) return;
    b.textContent = mensaje || "";
    b.hidden = !mensaje;
  }

  function errorNuevo(mensaje) {
    const p = dialogoNuevo?.querySelector('[data-equipo-nuevo-error="nombre"]');
    if (!p) return;
    p.textContent = mensaje || "";
    p.hidden = !mensaje;
  }

  async function crearEquipo() {
    const input = dialogoNuevo.querySelector('[data-equipo-nuevo-field="nombre"]');
    const nombre = limpiar(input.value);
    bannerNuevo("");
    errorNuevo("");
    if (nombre.length < 2 || nombre.length > 60) {
      errorNuevo("El nombre debe tener entre 2 y 60 caracteres.");
      return;
    }

    const guardar = dialogoNuevo.querySelector("[data-equipo-nuevo-guardar]");
    guardar.disabled = true;
    try {
      await apiJson("/api/admin/equipos", "POST", { nombre });
      dialogoNuevo.close();
      await recargar();
    } catch (err) {
      if (err.campos?.nombre) errorNuevo(err.campos.nombre);
      bannerNuevo(err.message);
    } finally {
      guardar.disabled = false;
    }
  }

  dialogoNuevo?.querySelector("[data-equipo-nuevo-guardar]")?.addEventListener("click", crearEquipo);

  /*
   * Enter en el nombre tiene que crear el equipo, no enviar el formulario.
   * «Crear equipo» está fuera del <form> y es type="button", así que el form se
   * queda con un solo campo y ningún submit: justo la forma con la que el
   * navegador hace *implicit submission* al pulsar Enter. Sin este manejador la
   * acción por defecto navega a la propia URL, el panel se recarga y el alta se
   * pierde sin decir nada.
   */
  dialogoNuevo?.querySelector("[data-equipo-nuevo-form]")?.addEventListener("submit", (evento) => {
    evento.preventDefault();
    crearEquipo();
  });

  dialogoNuevo?.querySelector("[data-equipo-nuevo-cerrar]")?.addEventListener("click", () => dialogoNuevo.close());
  dialogoNuevo?.querySelector("[data-equipo-nuevo-cancelar]")?.addEventListener("click", () => dialogoNuevo.close());

  dialogo?.addEventListener("close", () => {
    equipoEnEdicion = null;
    liberarFotoEquipo();
    // Libera los object URL de las previsualizaciones antes de vaciar.
    listaJugadores.querySelectorAll("[data-photo-preview]").forEach((img) => {
      if (img.dataset.objectUrl === "1") URL.revokeObjectURL(img.src);
    });
    listaJugadores.innerHTML = "";
  });
})();
