/*
 * /admin/estadisticas/ — lo que alimenta el álbum público de /jugadores/.
 *
 * Una fila por jugador de la edición en juego. El diálogo enseña las cifras de
 * juego en sólo lectura (salen de los partidos) y guarda las dos cosas que sí
 * se anotan a mano: los atributos 1–5 y si la persona aparece o no en el
 * álbum.
 *
 * Las métricas y los atributos llegan del servidor (GET devuelve `metricas` y
 * `atributos`), así que no hay una lista que mantener sincronizada aquí.
 */
(() => {
  const raiz = document.querySelector("[data-admin-estadisticas]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, apiJson, onReady, recargar, el, clear, tabla, celda, boton, etiqueta } = window.CopaAdmin;

  const buscador = document.querySelector("[data-admin-buscar]");
  const contador = document.querySelector("[data-admin-contador]");
  const dialogo = document.querySelector("[data-stats-dialog]");
  const cajaMetricas = dialogo?.querySelector("[data-stats-metricas]");
  const cajaAtributos = dialogo?.querySelector("[data-stats-atributos]");
  const checkOculto = dialogo?.querySelector("[data-stats-oculto]");

  const ETIQUETAS_ATRIBUTO = {
    saque: "Saque",
    remate: "Remate",
    bloqueo: "Bloqueo",
    defensa: "Defensa",
    recepcion: "Recepción",
    colocacion: "Colocación"
  };

  let jugadores = [];
  let metricas = [];
  let atributos = [];
  let filtro = "";
  let enEdicion = null;

  const nombreCompleto = (j) => `${j.nombre} ${j.apellidos}`.trim();

  // Columnas destacadas en la tabla; el resto de cifras se ve en el diálogo.
  const COLUMNAS_TABLA = ["puntos", "remates", "bloqueos", "aces"];

  onReady(async () => {
    const datos = await api("/api/admin/estadisticas");
    jugadores = datos.jugadores || [];
    metricas = datos.metricas || [];
    atributos = datos.atributos || [];

    if (contador) {
      const conCifras = jugadores.filter((j) => COLUMNAS_TABLA.some((c) => (j.estadisticas?.[c] ?? 0) > 0)).length;
      contador.textContent = `${jugadores.length} jugadores · ${conCifras} con estadísticas`;
    }

    pintar();
  });

  function visibles() {
    const termino = filtro.trim().toLowerCase();
    if (!termino) return jugadores;
    return jugadores.filter((j) => `${nombreCompleto(j)} ${j.equipoNombre}`.toLowerCase().includes(termino));
  }

  function pintar() {
    clear(raiz);

    const columnasMetrica = metricas
      .filter((m) => COLUMNAS_TABLA.includes(m.clave))
      .map((m) => ({
        etiqueta: m.etiqueta,
        clase: "is-num is-shrink",
        render: (j) => String(j.estadisticas?.[m.clave] ?? 0)
      }));

    raiz.append(
      tabla({
        vacio: "No hay jugadores inscritos en la edición en juego.",
        filas: visibles(),
        columnas: [
          { etiqueta: "Jugador", clase: "is-strong", render: (j) => nombreCompleto(j) },
          { etiqueta: "Equipo", clase: "is-clip", render: (j) => j.equipoNombre },
          ...columnasMetrica,
          {
            etiqueta: "Álbum",
            clase: "is-shrink",
            render: (j) => (j.ocultoPublico ? etiqueta("Oculto", "warn") : "Visible")
          },
          {
            etiqueta: "Acciones",
            clase: "is-actions",
            render: (j) => celda("admin-row-actions", boton("Editar", () => abrir(j)))
          }
        ]
      })
    );
  }

  buscador?.addEventListener("input", () => {
    filtro = buscador.value;
    pintar();
  });

  // ------------------------------------------------------------ diálogo ---

  function cifraSoloLectura(nombre, valor) {
    return [el("dt", "admin-stat-label", nombre), el("dd", "admin-stat-valor", valor ?? 0)];
  }

  function campoNumero(clave, etiqueta, valor, { min, max, dataset }) {
    const wrap = el("div", "admin-field");
    const id = `stats-${dataset}-${clave}`;
    const label = document.createElement("label");
    label.htmlFor = id;
    label.textContent = etiqueta;
    const input = document.createElement("input");
    input.id = id;
    input.className = "admin-input";
    input.type = "number";
    input.min = String(min);
    input.max = String(max);
    input.inputMode = "numeric";
    input.value = valor == null ? "" : String(valor);
    input.dataset[dataset] = clave;
    const error = el("p", "admin-field-error");
    error.dataset.statsError = `${dataset}.${clave}`;
    error.hidden = true;
    wrap.append(label, input, error);
    return wrap;
  }

  function abrir(jugador) {
    if (!dialogo) return;
    enEdicion = jugador;
    banner("");

    dialogo.querySelector("[data-stats-titulo]").textContent = nombreCompleto(jugador);
    dialogo.querySelector("[data-stats-sub]").textContent = jugador.equipoNombre;

    clear(cajaMetricas);
    metricas.forEach((m) => {
      cajaMetricas.append(...cifraSoloLectura(m.etiqueta, jugador.estadisticas?.[m.clave]));
    });

    clear(cajaAtributos);
    atributos.forEach((clave) => {
      cajaAtributos.append(
        campoNumero(clave, ETIQUETAS_ATRIBUTO[clave] || clave, jugador.atributos?.[clave] ?? null, {
          min: 1,
          max: 5,
          dataset: "atributo"
        })
      );
    });

    if (checkOculto) checkOculto.checked = Boolean(jugador.ocultoPublico);

    dialogo.showModal();
  }

  function banner(mensaje) {
    const b = dialogo?.querySelector("[data-stats-banner]");
    if (!b) return;
    b.textContent = mensaje || "";
    b.hidden = !mensaje;
  }

  function marcarError(clave, mensaje) {
    const nodo = dialogo?.querySelector(`[data-stats-error="${clave}"]`);
    if (!nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
    nodo.closest(".admin-field")?.classList.toggle("has-error", Boolean(mensaje));
  }

  function limpiarErrores() {
    dialogo?.querySelectorAll("[data-stats-error]").forEach((nodo) => {
      nodo.textContent = "";
      nodo.hidden = true;
      nodo.closest(".admin-field")?.classList.remove("has-error");
    });
  }

  function recoger(dataset) {
    const valores = {};
    dialogo?.querySelectorAll(`[data-${dataset}]`).forEach((input) => {
      const clave = input.dataset[dataset];
      const bruto = input.value.trim();
      // El vacío se manda como cadena: el servidor lo entiende como «sin dato».
      valores[clave] = bruto === "" ? "" : Number(bruto);
    });
    return valores;
  }

  dialogo?.querySelector("[data-stats-guardar]")?.addEventListener("click", async () => {
    if (!enEdicion) return;
    limpiarErrores();
    banner("");

    const guardar = dialogo.querySelector("[data-stats-guardar]");
    guardar.disabled = true;
    try {
      await apiJson(`/api/admin/estadisticas?jugador=${encodeURIComponent(enEdicion.id)}`, "PATCH", {
        atributos: recoger("atributo"),
        ocultoPublico: Boolean(checkOculto?.checked)
      });
      dialogo.close();
      await recargar();
    } catch (err) {
      Object.entries(err.campos || {}).forEach(([clave, mensaje]) => {
        marcarError(clave.replace("atributos.", "atributo."), mensaje);
      });
      banner(err.message);
    } finally {
      guardar.disabled = false;
    }
  });

  dialogo?.querySelector("[data-stats-cerrar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.querySelector("[data-stats-cancelar]")?.addEventListener("click", () => dialogo.close());
  dialogo?.addEventListener("close", () => {
    enEdicion = null;
  });
})();
