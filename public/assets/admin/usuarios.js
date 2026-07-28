/*
 * /admin/usuarios/ — cuentas de Google, sus permisos y su ficha de jugador.
 *
 * No hay alta ni baja: las crea Google al iniciar sesión, y borrarlas se
 * descartó a propósito. Sí está aquí el botón «Ver como», que arranca el modo
 * de solo lectura con la sesión de esa persona.
 */
(() => {
  const raiz = document.querySelector("[data-admin-usuarios]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, apiJson, onReady, recargar, setError, el, clear, text, tabla, celda, boton, enlace, etiqueta, limpiar, confirmar } =
    window.CopaAdmin;

  const buscador = document.querySelector("[data-admin-buscar]");
  const contador = document.querySelector("[data-admin-contador]");

  const dialogo = document.querySelector("[data-usuario-dialog]");
  const form = dialogo?.querySelector("[data-usuario-form]");
  const banner = dialogo?.querySelector("[data-usuario-banner]");
  const cajaAtributos = dialogo?.querySelector("[data-usuario-atributos]");
  const cajaResumen = dialogo?.querySelector("[data-usuario-resumen]");

  const ATRIBUTOS = [
    ["saque", "Saque"],
    ["remate", "Remate"],
    ["bloqueo", "Bloqueo"],
    ["defensa", "Defensa"],
    ["recepcion", "Recepción"],
    ["colocacion", "Colocación"]
  ];
  const CAMPOS_PERFIL = ["apodo", "dorsal", "posicion", "mano", "lema"];

  let usuarios = [];
  let enEdicion = null;

  const campo = (nombre) => form?.querySelector(`[data-usuario-field="${nombre}"]`);

  // ------------------------------------------------------------- listado ---

  onReady(async () => {
    const datos = await api("/api/admin/usuarios");
    usuarios = Array.isArray(datos.usuarios) ? datos.usuarios : [];
    pintar();
  });

  function pintar() {
    const filtro = limpiar(buscador?.value || "").toLowerCase();
    const visibles = filtro
      ? usuarios.filter((u) =>
          `${u.nombre || ""} ${u.email} ${u.equipoNombre || ""}`.toLowerCase().includes(filtro)
        )
      : usuarios;

    if (contador) {
      const admins = usuarios.filter((u) => u.esAdmin).length;
      contador.textContent =
        visibles.length === usuarios.length
          ? `${usuarios.length} cuentas · ${admins} admin`
          : `${visibles.length} de ${usuarios.length} cuentas`;
    }

    clear(raiz);
    raiz.append(
      tabla({
        vacio: filtro ? "Ninguna cuenta coincide con la búsqueda." : "Todavía no ha entrado nadie.",
        filas: visibles,
        columnas: [
          { etiqueta: "#", clase: "is-num is-shrink", render: (u) => String(u.id) },
          { etiqueta: "Nombre", clase: "is-strong", render: (u) => text(u.nombre) },
          { etiqueta: "Correo", clase: "is-clip", render: (u) => u.email },
          {
            etiqueta: "Equipo",
            render: (u) =>
              u.equipoId
                ? enlace(u.equipoNombre || `#${u.equipoId}`, `/admin/equipos/?id=${encodeURIComponent(u.equipoId)}`)
                : "—"
          },
          { etiqueta: "Camisetas", clase: "is-num is-shrink", render: (u) => String(u.camisetas || 0) },
          {
            etiqueta: "Rol",
            clase: "is-shrink",
            render: (u) => (u.esAdmin ? etiqueta("Admin", "info") : etiqueta("Jugador", "mute"))
          },
          {
            etiqueta: "Acciones",
            clase: "is-actions",
            render: (u) =>
              celda(
                "admin-row-actions",
                boton("Ver como", () => verComo(u)),
                boton("Editar", () => abrir(u))
              )
          }
        ]
      })
    );
  }

  buscador?.addEventListener("input", pintar);

  // ------------------------------------------------------------ ver como ---

  async function verComo(usuario) {
    const ok = await confirmar({
      titulo: "Ver el sitio como esta persona",
      texto: `Vas a recorrer el sitio con la sesión de ${usuario.nombre || usuario.email}.`,
      aviso: "Es solo lectura: mientras dure no podrás guardar nada, ni en el panel ni fuera de él. Dura 30 minutos o hasta que vuelvas a tu cuenta.",
      accion: "Ver como"
    });
    if (!ok) return;

    try {
      await apiJson("/api/admin/ver-como", "POST", { usuarioId: usuario.id });
      // A «Mi zona», que es donde la suplantación se nota de verdad.
      window.location.href = "/mi-equipo/";
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
    const nodo = form.querySelector(`[data-usuario-error="${nombre}"]`);
    if (!nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
    campo(nombre)?.closest(".admin-field")?.classList.toggle("has-error", Boolean(mensaje));
  }

  function limpiarErrores() {
    setBanner("");
    ["nombre", "esAdmin", ...CAMPOS_PERFIL].forEach((n) => setErrorCampo(n, ""));
  }

  function pintarAtributos(valores) {
    clear(cajaAtributos);
    ATRIBUTOS.forEach(([clave, etiquetaTexto]) => {
      const caja = el("div", "admin-field");
      const label = document.createElement("label");
      label.textContent = etiquetaTexto;
      label.htmlFor = `usuario-attr-${clave}`;
      const input = document.createElement("input");
      input.id = `usuario-attr-${clave}`;
      input.className = "admin-input";
      input.type = "number";
      input.min = "1";
      input.max = "5";
      input.dataset.usuarioAtributo = clave;
      input.value = valores[clave] != null ? String(valores[clave]) : "";
      caja.append(label, input);
      cajaAtributos.append(caja);
    });
  }

  /** Contexto de solo lectura: en qué equipos ha estado y qué ha reservado. */
  function pintarResumen(ficha) {
    clear(cajaResumen);
    const bloque = (titulo, filas) => {
      const caja = el("div", "admin-usuario-bloque");
      caja.append(el("h3", "admin-usuario-bloque-titulo", titulo));
      if (filas.length === 0) {
        caja.append(el("p", "admin-hint", "Nada todavía."));
      } else {
        const lista = el("ul", "admin-usuario-lista");
        filas.forEach((texto) => lista.append(el("li", "", texto)));
        caja.append(lista);
      }
      return caja;
    };

    cajaResumen.append(
      bloque(
        "Equipos",
        (ficha.equipos || []).map(
          (e) => `${e.edicionAnio ?? "—"} · ${e.nombre}${e.posicionFinal ? ` (${e.posicionFinal}º)` : ""}`
        )
      ),
      bloque(
        "Camisetas",
        (ficha.camisetas || []).map((c) => `${c.edicionAnio ?? "—"} · ${c.cantidad} × talla ${c.talla} (${c.nombre})`)
      )
    );
  }

  async function abrir(usuario) {
    if (!dialogo) return;
    limpiarErrores();

    try {
      const datos = await api(`/api/admin/usuarios?id=${encodeURIComponent(usuario.id)}`);
      enEdicion = datos.usuario;
    } catch (err) {
      setError(err.message);
      return;
    }

    dialogo.querySelector("[data-usuario-titulo]").textContent = enEdicion.nombre || enEdicion.email;
    dialogo.querySelector("[data-usuario-sub]").textContent =
      `${enEdicion.email} · cuenta #${enEdicion.id} desde ${String(enEdicion.createdAt).slice(0, 10)}`;

    campo("nombre").value = enEdicion.nombre || "";
    campo("esAdmin").checked = Boolean(enEdicion.esAdmin);
    CAMPOS_PERFIL.forEach((n) => {
      const input = campo(n);
      if (input) input.value = enEdicion.perfil?.[n] ?? "";
    });
    pintarAtributos(enEdicion.perfil?.atributos || {});
    pintarResumen(enEdicion);

    dialogo.showModal();
  }

  dialogo?.querySelector("[data-usuario-guardar]")?.addEventListener("click", async () => {
    limpiarErrores();

    const atributos = {};
    cajaAtributos.querySelectorAll("[data-usuario-atributo]").forEach((input) => {
      if (input.value !== "") atributos[input.dataset.usuarioAtributo] = Number(input.value);
    });

    const datos = {
      nombre: limpiar(campo("nombre").value),
      esAdmin: campo("esAdmin").checked,
      perfil: {
        apodo: limpiar(campo("apodo").value),
        dorsal: campo("dorsal").value,
        posicion: campo("posicion").value,
        mano: campo("mano").value,
        lema: limpiar(campo("lema").value),
        atributos
      }
    };

    const guardar = dialogo.querySelector("[data-usuario-guardar]");
    guardar.disabled = true;
    try {
      await apiJson(`/api/admin/usuarios?id=${encodeURIComponent(enEdicion.id)}`, "PATCH", datos);
      dialogo.close();
      await recargar();
      const lista = await api("/api/admin/usuarios");
      usuarios = Array.isArray(lista.usuarios) ? lista.usuarios : [];
      pintar();
    } catch (err) {
      Object.entries(err.campos || {}).forEach(([n, m]) => setErrorCampo(n.replace(/^atributos\./, ""), m));
      setBanner(err.message);
    } finally {
      guardar.disabled = false;
    }
  });

  dialogo?.querySelector("[data-usuario-cerrar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.querySelector("[data-usuario-cancelar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.addEventListener("close", () => {
    enEdicion = null;
  });
})();
