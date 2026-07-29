/*
 * /admin/jugadores/ — tabla global de jugadores, alta suelta, edición y cambio
 * de equipo.
 *
 * Es la vista complementaria de /admin/equipos/: allí se trabaja la plantilla
 * entera, aquí persona a persona. La ficha de equipo enlaza aquí filtrado con
 * ?equipo=N, y cada fila enlaza de vuelta a su equipo.
 *
 * La validación por campo replica functions/api/admin/jugadores.ts: si cambia
 * una, hay que cambiar la otra.
 */
(() => {
  const raiz = document.querySelector("[data-admin-jugadores]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, resumen, onReady, recargar, setError, el, clear, text, tabla, celda, boton, enlace, etiqueta, limpiar, confirmar } =
    window.CopaAdmin;

  const buscador = document.querySelector("[data-admin-buscar]");
  const filtroEquipo = document.querySelector("[data-filtro-equipo]");
  const contador = document.querySelector("[data-admin-contador]");
  const btnNuevo = document.querySelector("[data-jugador-nuevo]");

  const dialogo = document.querySelector("[data-jugador-dialog]");
  const form = dialogo?.querySelector("[data-jugador-form]");
  const titulo = dialogo?.querySelector("[data-jugador-titulo]");
  const sub = dialogo?.querySelector("[data-jugador-sub]");
  const banner = dialogo?.querySelector("[data-jugador-banner]");
  const avisoEquipo = dialogo?.querySelector("[data-jugador-aviso-equipo]");
  const vistaFoto = dialogo?.querySelector("[data-jugador-foto]");
  const vistaFotoVacia = dialogo?.querySelector("[data-jugador-foto-vacia]");

  const MAX_FOTO_BYTES = 4 * 1024 * 1024;
  const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
  const NOMBRE_RE = /^[\p{L}\p{M}'’. -]+$/u;
  const EMAIL_RE = /^\S+@\S+\.\S+$/;
  const HANDLE_RE = /^@?[a-zA-Z0-9._]{2,30}$/;
  const URL_SOCIAL_RE = /^https:\/\/\S{5,110}$/;
  const MENSAJE_CAPITAN_CONTACTO = "El capitán necesita móvil y correo para que podamos avisaros.";
  const CAMPOS = ["nombre", "apellidos", "telefono", "email", "redSocial"];

  let jugadores = [];
  let equipos = [];
  let enEdicion = null;

  // El filtro inicial puede venir de la ficha de equipo: /admin/jugadores/?equipo=12
  const paramEquipo = new URLSearchParams(location.search).get("equipo");

  const fotoDe = (id) => `/api/admin/fotos?jugador=${encodeURIComponent(id)}`;
  const campo = (nombre) => form?.querySelector(`[data-jugador-field="${nombre}"]`);

  // ------------------------------------------------------------- listado ---

  onReady(async () => {
    const [datos, resumenDatos] = await Promise.all([api("/api/admin/jugadores"), resumen()]);
    jugadores = Array.isArray(datos.jugadores) ? datos.jugadores : [];
    equipos = (resumenDatos.equipos || []).map((e) => ({ id: e.id, nombre: e.nombre, capitanJugadorId: e.capitanJugadorId ?? null }));

    pintarSelectores();
    pintar();
  });

  function pintarSelectores() {
    if (filtroEquipo) {
      const valorPrevio = filtroEquipo.value || paramEquipo || "";
      clear(filtroEquipo);
      filtroEquipo.append(new Option("Todos los equipos", ""));
      equipos.forEach((e) => filtroEquipo.append(new Option(e.nombre, String(e.id))));
      filtroEquipo.value = valorPrevio;
    }

    const selectEquipo = campo("equipoId");
    if (selectEquipo) {
      clear(selectEquipo);
      equipos.forEach((e) => selectEquipo.append(new Option(e.nombre, String(e.id))));
    }
  }

  function pintar() {
    const filtro = limpiar(buscador?.value || "").toLowerCase();
    const equipoId = filtroEquipo?.value ? Number(filtroEquipo.value) : null;

    const visibles = jugadores.filter((j) => {
      if (equipoId !== null && j.equipoId !== equipoId) return false;
      if (!filtro) return true;
      return `${j.nombre} ${j.apellidos} ${j.email || ""} ${j.telefono || ""} ${j.equipoNombre || ""}`
        .toLowerCase()
        .includes(filtro);
    });

    if (contador) {
      contador.textContent =
        visibles.length === jugadores.length
          ? `${jugadores.length} jugadores`
          : `${visibles.length} de ${jugadores.length} jugadores`;
    }

    clear(raiz);
    raiz.append(
      tabla({
        vacio: jugadores.length === 0 ? "Todavía no hay jugadores." : "Ningún jugador coincide con el filtro.",
        filas: visibles,
        columnas: [
          { etiqueta: "#", clase: "is-num is-shrink", render: (j) => String(j.id) },
          {
            etiqueta: "Jugador",
            render: (j) => {
              const caja = celda("admin-cell-media");
              if (j.tieneFoto) {
                const img = document.createElement("img");
                img.className = "admin-thumb";
                img.alt = "";
                img.loading = "lazy";
                img.src = fotoDe(j.id);
                caja.append(img);
              } else {
                caja.append(el("span", "admin-thumb is-empty"));
              }
              caja.append(el("span", "is-strong", `${j.nombre} ${j.apellidos}`));
              return caja;
            }
          },
          {
            etiqueta: "Equipo",
            render: (j) =>
              j.equipoId
                ? enlace(j.equipoNombre || `#${j.equipoId}`, `/admin/equipos/?id=${encodeURIComponent(j.equipoId)}`)
                : "—"
          },
          {
            etiqueta: "Rol",
            clase: "is-shrink",
            render: (j) => etiqueta(j.esSuplente ? "Suplente" : "Titular", j.esSuplente ? "mute" : "info")
          },
          { etiqueta: "Móvil", clase: "is-num", render: (j) => text(j.telefono) },
          { etiqueta: "Correo", clase: "is-clip", render: (j) => text(j.email) },
          { etiqueta: "Edición", clase: "is-num is-shrink", render: (j) => text(j.edicionAnio) },
          {
            etiqueta: "Acciones",
            clase: "is-actions",
            render: (j) =>
              celda(
                "admin-row-actions",
                boton("Editar", () => abrir(j)),
                boton("Borrar", () => borrar(j), "admin-btn admin-btn--sm admin-btn--danger")
              )
          }
        ]
      })
    );
  }

  buscador?.addEventListener("input", pintar);
  filtroEquipo?.addEventListener("change", pintar);

  // ------------------------------------------------------------- borrado ---

  async function borrar(jugador) {
    const ok = await confirmar({
      titulo: "Borrar jugador",
      texto: `Se va a borrar a ${jugador.nombre} ${jugador.apellidos} de ${jugador.equipoNombre || "su equipo"}.`,
      aviso: jugador.tieneFoto ? "Se borra también su foto. No se puede deshacer." : "No se puede deshacer.",
      accion: "Borrar jugador"
    });
    if (!ok) return;

    try {
      await api(`/api/admin/jugadores?id=${encodeURIComponent(jugador.id)}`, { method: "DELETE" });
      await recargar();
    } catch (err) {
      setError(err.message);
    }
  }

  // -------------------------------------------------------------- diálogo ---

  function setBanner(mensaje) {
    banner.textContent = mensaje || "";
    banner.hidden = !mensaje;
  }

  function setErrorCampo(nombre, mensaje) {
    const nodo = form.querySelector(`[data-jugador-error="${nombre}"]`);
    if (!nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
    campo(nombre)?.closest(".admin-field")?.classList.toggle("has-error", Boolean(mensaje));
  }

  function limpiarErrores() {
    setBanner("");
    [...CAMPOS, "equipoId", "foto"].forEach((n) => setErrorCampo(n, ""));
  }

  function abrir(jugador) {
    if (!dialogo) return;
    enEdicion = jugador;
    limpiarErrores();
    form.reset();

    titulo.textContent = jugador ? `${jugador.nombre} ${jugador.apellidos}` : "Nuevo jugador";
    sub.textContent = jugador
      ? `Jugador #${jugador.id} · ${jugador.equipoNombre || "sin equipo"}`
      : "Entra al final de la plantilla del equipo que elijas.";
    avisoEquipo.hidden = !jugador;

    CAMPOS.forEach((n) => {
      const input = campo(n);
      if (input) input.value = jugador ? jugador[n] || "" : "";
    });
    campo("equipoId").value = jugador?.equipoId ? String(jugador.equipoId) : equipos[0] ? String(equipos[0].id) : "";
    campo("eliminarFoto").checked = false;
    campo("foto").value = "";

    liberarPrevisualizacion();
    if (jugador?.tieneFoto) {
      vistaFoto.src = fotoDe(jugador.id);
      vistaFoto.hidden = false;
      vistaFotoVacia.hidden = true;
    } else {
      vistaFoto.hidden = true;
      vistaFotoVacia.hidden = false;
    }

    actualizarRotulosContacto();
    dialogo.showModal();
  }

  /** Móvil y correo llevan «(opcional)» salvo en la ficha del capitán. */
  function actualizarRotulosContacto() {
    const esCapitan = esCapitanEnEdicion();
    const optTelefono = form.querySelector('[data-jugador-opt="telefono"]');
    const optEmail = form.querySelector('[data-jugador-opt="email"]');
    if (optTelefono) optTelefono.hidden = esCapitan;
    if (optEmail) optEmail.hidden = esCapitan;
  }

  function liberarPrevisualizacion() {
    if (vistaFoto.dataset.objectUrl === "1") {
      URL.revokeObjectURL(vistaFoto.src);
      delete vistaFoto.dataset.objectUrl;
    }
  }

  campo("foto")?.addEventListener("change", () => {
    const archivo = campo("foto").files?.[0];
    if (!archivo) return;
    if (archivo.size > MAX_FOTO_BYTES || !TIPOS_FOTO.includes(archivo.type)) {
      setErrorCampo("foto", "Solo se admiten fotos JPG, PNG o WebP de hasta 4 MB.");
      campo("foto").value = "";
      return;
    }
    setErrorCampo("foto", "");
    campo("eliminarFoto").checked = false;
    liberarPrevisualizacion();
    vistaFoto.src = URL.createObjectURL(archivo);
    vistaFoto.dataset.objectUrl = "1";
    vistaFoto.hidden = false;
    vistaFotoVacia.hidden = true;
  });

  campo("eliminarFoto")?.addEventListener("change", () => {
    if (campo("eliminarFoto").checked) {
      campo("foto").value = "";
      liberarPrevisualizacion();
      vistaFoto.hidden = true;
      vistaFotoVacia.hidden = false;
    } else if (enEdicion?.tieneFoto) {
      vistaFoto.src = fotoDe(enEdicion.id);
      vistaFoto.hidden = false;
      vistaFotoVacia.hidden = true;
    }
  });

  /** El jugador en edición manda hoy en su equipo. Nunca lo es un alta nueva:
   *  una fila que aún no existe no puede ser ya la que figura en `equipos`. */
  function esCapitanEnEdicion() {
    return Boolean(enEdicion) && equipos.some((e) => e.capitanJugadorId === enEdicion.id);
  }

  function validar() {
    const valores = {};
    CAMPOS.forEach((n) => {
      valores[n] = limpiar(campo(n)?.value);
    });
    const errores = {};
    const esCapitan = esCapitanEnEdicion();

    if (valores.nombre.length < 2 || valores.nombre.length > 60 || !NOMBRE_RE.test(valores.nombre)) {
      errores.nombre = "Introduce el nombre (solo letras, entre 2 y 60 caracteres).";
    }
    if (valores.apellidos.length < 2 || valores.apellidos.length > 80 || !NOMBRE_RE.test(valores.apellidos)) {
      errores.apellidos = "Introduce los apellidos (solo letras, entre 2 y 80 caracteres).";
    }
    // Móvil y correo: obligatorios solo para el capitán, igual que en
    // functions/api/admin/jugadores.ts (validarJugador).
    if (!valores.telefono) {
      if (esCapitan) errores.telefono = MENSAJE_CAPITAN_CONTACTO;
    } else if (!/^[67]\d{8}$/.test(valores.telefono.replace(/\D/g, "").replace(/^34(?=\d{9}$)/, ""))) {
      errores.telefono = "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos).";
    }
    if (!valores.email) {
      if (esCapitan) errores.email = MENSAJE_CAPITAN_CONTACTO;
    } else if (!EMAIL_RE.test(valores.email) || valores.email.length > 120) {
      errores.email = "Ese correo no parece válido.";
    }
    if (
      valores.redSocial &&
      (valores.redSocial.length > 120 || !(HANDLE_RE.test(valores.redSocial) || URL_SOCIAL_RE.test(valores.redSocial)))
    ) {
      errores.redSocial = "Usa un usuario tipo @nombre o un enlace https://.";
    }
    if (!campo("equipoId").value) errores.equipoId = "Elige un equipo.";

    Object.entries(errores).forEach(([n, m]) => setErrorCampo(n, m));
    return Object.keys(errores).length === 0 ? valores : null;
  }

  dialogo?.querySelector("[data-jugador-guardar]")?.addEventListener("click", async () => {
    limpiarErrores();
    const valores = validar();
    if (!valores) {
      setBanner("Revisa los campos marcados.");
      return;
    }

    const envio = new FormData();
    envio.append("equipoId", campo("equipoId").value);
    CAMPOS.forEach((n) => envio.append(n, valores[n]));
    const archivo = campo("foto").files?.[0];
    if (archivo) envio.append("foto", archivo);
    if (campo("eliminarFoto").checked) envio.append("eliminarFoto", "1");

    const guardar = dialogo.querySelector("[data-jugador-guardar]");
    guardar.disabled = true;
    const textoOriginal = guardar.textContent;
    guardar.textContent = "Guardando…";

    try {
      const url = enEdicion ? `/api/admin/jugadores?id=${encodeURIComponent(enEdicion.id)}` : "/api/admin/jugadores";
      await api(url, { method: enEdicion ? "PATCH" : "POST", body: envio });
      dialogo.close();
      await recargar();
      // El listado de jugadores no está en /api/admin: hay que releerlo aparte.
      const datos = await api("/api/admin/jugadores");
      jugadores = Array.isArray(datos.jugadores) ? datos.jugadores : [];
      pintar();
    } catch (err) {
      Object.entries(err.campos || {}).forEach(([n, m]) => setErrorCampo(n, m));
      setBanner(err.message);
    } finally {
      guardar.disabled = false;
      guardar.textContent = textoOriginal;
    }
  });

  btnNuevo?.addEventListener("click", () => abrir(null));
  dialogo?.querySelector("[data-jugador-cerrar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.querySelector("[data-jugador-cancelar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.addEventListener("close", () => {
    liberarPrevisualizacion();
    enEdicion = null;
  });
})();
