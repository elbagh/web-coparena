/*
 * /admin/roles/ — un rol es un conjunto de permisos, y cada cuenta lleva uno.
 *
 * Los permisos se pintan como matriz porque el catálogo lo es: cada clave es
 * `recurso.accion`. El catálogo llega del servidor en la misma respuesta, así
 * que esta pantalla no puede ofrecer un permiso que luego se rechace.
 *
 * El rol de administración se abre en solo lectura: sus permisos son implícitos
 * y totales, y si se pudieran recortar, un administrador podría quitarse
 * `roles.editar` y dejar el sistema sin nadie capaz de repartir permisos.
 */
(() => {
  const raiz = document.querySelector("[data-admin-roles]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, apiJson, onReady, recargar, setError, el, clear, text, tabla, celda, boton, etiqueta, limpiar, confirmar, puede } =
    window.CopaAdmin;

  const dialogo = document.querySelector("[data-rol-dialog]");
  const form = dialogo?.querySelector("[data-rol-form]");
  const banner = dialogo?.querySelector("[data-rol-banner]");
  const nota = dialogo?.querySelector("[data-rol-nota]");
  const matriz = dialogo?.querySelector("[data-rol-matriz]");
  const cuenta = dialogo?.querySelector("[data-rol-cuenta]");

  let roles = [];
  let catalogo = [];
  let enEdicion = null;

  const campo = (nombre) => form?.querySelector(`[data-rol-field="${nombre}"]`);
  const casillas = () => [...(matriz?.querySelectorAll("[data-rol-permiso]") || [])];

  // ------------------------------------------------------------- listado ---

  onReady(async () => {
    const datos = await api("/api/admin/roles");
    roles = Array.isArray(datos.roles) ? datos.roles : [];
    catalogo = Array.isArray(datos.catalogo) ? datos.catalogo : [];
    pintar();
  });

  function pintar() {
    clear(raiz);
    raiz.append(
      tabla({
        vacio: "No hay ningún rol todavía.",
        filas: roles,
        columnas: [
          { etiqueta: "Rol", clase: "is-strong", render: (r) => text(r.nombre) },
          { etiqueta: "Clave", clase: "is-clip", render: (r) => r.clave },
          { etiqueta: "Descripción", clase: "is-clip", render: (r) => text(r.descripcion) },
          {
            etiqueta: "Permisos",
            clase: "is-num is-shrink",
            render: (r) => (r.esSistema ? "Todos" : String(r.permisos.length))
          },
          { etiqueta: "Cuentas", clase: "is-num is-shrink", render: (r) => String(r.usuarios) },
          {
            etiqueta: "Tipo",
            clase: "is-shrink",
            render: (r) => (r.esSistema ? etiqueta("Sistema", "info") : etiqueta("Editable", "mute"))
          },
          {
            etiqueta: "Acciones",
            clase: "is-actions",
            render: (r) =>
              celda(
                "admin-row-actions",
                boton(r.esSistema ? "Ver" : "Editar", () => abrir(r)),
                !r.esSistema && boton("Borrar", () => borrar(r), "admin-btn admin-btn--sm admin-btn--danger")
              )
          }
        ]
      })
    );
  }

  // -------------------------------------------------------------- matriz ---

  /** Las acciones, en el orden en que aparecen por primera vez en el catálogo. */
  function columnas() {
    const vistas = new Map();
    catalogo.forEach((permiso) => {
      if (!vistas.has(permiso.accion)) vistas.set(permiso.accion, permiso.etiqueta);
    });
    return [...vistas].map(([accion, etiquetaAccion]) => ({ accion, etiqueta: etiquetaAccion }));
  }

  /** Los recursos, en el orden del catálogo. */
  function filas() {
    const vistos = new Map();
    catalogo.forEach((permiso) => {
      if (!vistos.has(permiso.recurso)) vistos.set(permiso.recurso, permiso.recursoEtiqueta);
    });
    return [...vistos].map(([recurso, etiquetaRecurso]) => ({ recurso, etiqueta: etiquetaRecurso }));
  }

  function pintarMatriz(permisosActivos, soloLectura) {
    clear(matriz);
    const cols = columnas();
    const activos = new Set(permisosActivos);

    const thead = document.createElement("thead");
    const filaCabecera = document.createElement("tr");
    filaCabecera.append(cabecera("Recurso"));
    cols.forEach((col) => filaCabecera.append(cabecera(col.etiqueta)));
    filaCabecera.append(cabecera(""));
    thead.append(filaCabecera);

    const tbody = document.createElement("tbody");
    filas().forEach(({ recurso, etiqueta: etiquetaRecurso }) => {
      const tr = document.createElement("tr");

      const th = document.createElement("th");
      th.scope = "row";
      th.textContent = etiquetaRecurso;
      tr.append(th);

      cols.forEach((col) => {
        const td = document.createElement("td");
        const definicion = catalogo.find((p) => p.recurso === recurso && p.accion === col.accion);

        if (!definicion) {
          // Ese recurso no admite esa acción. El hueco lo dice mejor que una
          // casilla apagada, que insinuaría que existe y está desactivada.
          td.className = "roles-celda-vacia";
          td.textContent = "·";
          td.setAttribute("aria-label", `${etiquetaRecurso}: ${col.etiqueta} no aplica`);
          tr.append(td);
          return;
        }

        const fueraDeAlcance = !puede(definicion.clave);
        const input = document.createElement("input");
        input.type = "checkbox";
        input.dataset.rolPermiso = definicion.clave;
        input.dataset.rolRecurso = recurso;
        input.checked = activos.has(definicion.clave);
        input.disabled = soloLectura || fueraDeAlcance;
        input.setAttribute("aria-label", `${etiquetaRecurso}: ${col.etiqueta}`);
        if (fueraDeAlcance && !soloLectura) {
          td.className = "roles-celda--vetada";
          td.title = "No puedes conceder un permiso que tú no tienes.";
        }

        input.addEventListener("change", actualizarCuenta);
        td.append(input);
        tr.append(td);
      });

      const acciones = document.createElement("td");
      if (!soloLectura) {
        const toggle = el("button", "roles-fila-toggle", "todo");
        toggle.type = "button";
        toggle.addEventListener("click", () => alternarFila(recurso, toggle));
        acciones.append(toggle);
      }
      tr.append(acciones);

      tbody.append(tr);
    });

    matriz.append(thead, tbody);
    actualizarCuenta();
  }

  function cabecera(texto) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = texto;
    return th;
  }

  function alternarFila(recurso, toggle) {
    const deLaFila = casillas().filter((c) => c.dataset.rolRecurso === recurso && !c.disabled);
    const encender = deLaFila.some((c) => !c.checked);
    deLaFila.forEach((c) => {
      c.checked = encender;
    });
    toggle.textContent = encender ? "nada" : "todo";
    actualizarCuenta();
  }

  function actualizarCuenta() {
    if (!cuenta) return;
    const total = casillas().length;
    const marcados = casillas().filter((c) => c.checked).length;
    cuenta.textContent = `${marcados} de ${total} permisos`;
  }

  // ------------------------------------------------------------- diálogo ---

  const setBanner = (mensaje) => {
    banner.textContent = mensaje || "";
    banner.hidden = !mensaje;
  };

  function setErrorCampo(nombre, mensaje) {
    const nodo = form.querySelector(`[data-rol-error="${nombre}"]`);
    if (!nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
    campo(nombre)?.closest(".admin-field")?.classList.toggle("has-error", Boolean(mensaje));
  }

  const limpiarErrores = () => {
    setBanner("");
    ["clave", "nombre", "descripcion", "permisos"].forEach((n) => setErrorCampo(n, ""));
  };

  function setNota(mensaje, esAviso) {
    if (!nota) return;
    nota.textContent = mensaje || "";
    nota.hidden = !mensaje;
    nota.classList.toggle("roles-nota--aviso", Boolean(esAviso));
  }

  function abrir(rol) {
    if (!dialogo) return;
    limpiarErrores();
    enEdicion = rol;

    const soloLectura = Boolean(rol?.esSistema);
    dialogo.querySelector("[data-rol-titulo]").textContent = rol ? rol.nombre : "Nuevo rol";
    dialogo.querySelector("[data-rol-sub]").textContent = rol
      ? `${rol.clave} · ${rol.usuarios} cuenta(s)`
      : "Elige un nombre y marca lo que podrá hacer.";

    campo("nombre").value = rol?.nombre || "";
    campo("clave").value = rol?.clave || "";
    campo("descripcion").value = rol?.descripcion || "";

    // La clave identifica al rol en el código y en las semillas: se fija al crear.
    campo("clave").disabled = Boolean(rol);
    campo("nombre").disabled = soloLectura;
    campo("descripcion").disabled = soloLectura;

    setNota(
      soloLectura
        ? "El rol de administración es del sistema: tiene todos los permisos y no se puede editar ni borrar. Es lo que impide que alguien se quede sin poder repartir permisos."
        : "",
      soloLectura
    );

    pintarMatriz(rol?.permisos || [], soloLectura);

    dialogo.querySelector("[data-rol-guardar]").hidden = soloLectura;
    dialogo.querySelector("[data-rol-cancelar]").textContent = soloLectura ? "Cerrar" : "Cancelar";

    dialogo.showModal();
  }

  async function borrar(rol) {
    const ok = await confirmar({
      titulo: `Borrar el rol «${rol.nombre}»`,
      texto: "Dejará de existir y no se podrá asignar a nadie.",
      aviso:
        rol.usuarios > 0
          ? `Ahora mismo lo llevan ${rol.usuarios} cuenta(s): tendrás que cambiárselo antes.`
          : "Nadie lo lleva puesto, así que no afecta a ninguna cuenta.",
      accion: "Borrar rol"
    });
    if (!ok) return;

    try {
      const datos = await apiJson(`/api/admin/roles?id=${encodeURIComponent(rol.id)}`, "DELETE");
      roles = Array.isArray(datos.roles) ? datos.roles : roles;
      pintar();
      await recargar();
    } catch (err) {
      setError(err.message);
    }
  }

  document.querySelector("[data-rol-nuevo]")?.addEventListener("click", () => abrir(null));

  dialogo?.querySelector("[data-rol-guardar]")?.addEventListener("click", async () => {
    limpiarErrores();

    const datos = {
      clave: limpiar(campo("clave").value).toLowerCase(),
      nombre: limpiar(campo("nombre").value),
      descripcion: limpiar(campo("descripcion").value),
      permisos: casillas()
        .filter((c) => c.checked)
        .map((c) => c.dataset.rolPermiso)
    };

    const guardar = dialogo.querySelector("[data-rol-guardar]");
    guardar.disabled = true;
    try {
      const respuesta = enEdicion
        ? await apiJson(`/api/admin/roles?id=${encodeURIComponent(enEdicion.id)}`, "PATCH", datos)
        : await apiJson("/api/admin/roles", "POST", datos);
      roles = Array.isArray(respuesta.roles) ? respuesta.roles : roles;
      dialogo.close();
      pintar();
      await recargar();
    } catch (err) {
      Object.entries(err.campos || {}).forEach(([n, m]) => setErrorCampo(n, m));
      setBanner(err.message);
    } finally {
      guardar.disabled = false;
    }
  });

  dialogo?.querySelector("[data-rol-cerrar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.querySelector("[data-rol-cancelar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.addEventListener("close", () => {
    enEdicion = null;
  });
})();
