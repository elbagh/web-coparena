/*
 * /admin/camisetas/ — reservas de camiseta: alta y borrado.
 * La validación replica functions/api/admin/camisetas.ts: si cambia una, hay
 * que cambiar la otra.
 */
(() => {
  const raiz = document.querySelector("[data-admin-camisetas]");
  if (!raiz || !window.CopaAdmin) return;

  const { api, apiJson, resumen, onReady, recargar, setError, clear, text, tabla, celda, boton, limpiar, confirmar } =
    window.CopaAdmin;

  const form = document.querySelector("[data-admin-shirt-form]");
  const contador = document.querySelector("[data-admin-contador]");
  const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);
  const CAMPOS = ["nombre", "talla", "cantidad", "notas"];

  onReady(async () => {
    const datos = await resumen();
    const reservas = Array.isArray(datos.camisetas) ? datos.camisetas : [];

    if (contador) {
      const unidades = reservas.reduce((total, r) => total + (r.cantidad || 0), 0);
      contador.textContent = `${reservas.length} reservas · ${unidades} camisetas`;
    }

    clear(raiz);
    raiz.append(
      tabla({
        vacio: "Todavía no hay reservas de camiseta.",
        filas: reservas,
        columnas: [
          { etiqueta: "#", clase: "is-num is-shrink", render: (r) => String(r.id) },
          { etiqueta: "Nombre", clase: "is-strong", render: (r) => r.nombre },
          { etiqueta: "Talla", clase: "is-num is-shrink", render: (r) => r.talla },
          { etiqueta: "Unidades", clase: "is-num is-shrink", render: (r) => String(r.cantidad) },
          { etiqueta: "Cuenta", clase: "is-clip", render: (r) => text(r.ownerEmail) },
          { etiqueta: "Notas", clase: "is-clip", render: (r) => text(r.notas) },
          {
            etiqueta: "Acciones",
            clase: "is-actions",
            render: (r) =>
              celda(
                "admin-row-actions",
                boton("Borrar", () => borrar(r), "admin-btn admin-btn--sm admin-btn--danger")
              )
          }
        ]
      })
    );
  });

  async function borrar(reserva) {
    const ok = await confirmar({
      titulo: "Borrar reserva",
      texto: `Se va a borrar la reserva de ${reserva.cantidad} camiseta(s) talla ${reserva.talla} a nombre de ${reserva.nombre}.`,
      accion: "Borrar reserva"
    });
    if (!ok) return;

    try {
      await api(`/api/admin/camisetas?id=${encodeURIComponent(reserva.id)}`, { method: "DELETE" });
      await recargar();
    } catch (err) {
      setError(err.message);
    }
  }

  // ----------------------------------------------------------- alta ---

  const campo = (nombre) => form?.querySelector(`[data-admin-shirt-field="${nombre}"]`);
  const errorDe = (nombre) => form?.querySelector(`[data-admin-shirt-error="${nombre}"]`);

  function setBanner(mensaje, tipo = "error") {
    const banner = form?.querySelector("[data-admin-shirt-banner]");
    if (!banner) return;
    banner.textContent = mensaje || "";
    banner.className = tipo === "ok" ? "admin-alert admin-alert--ok" : "admin-alert";
    banner.hidden = !mensaje;
  }

  function setErrorCampo(nombre, mensaje) {
    const input = campo(nombre);
    const nodo = errorDe(nombre);
    if (!input || !nodo) return;
    nodo.textContent = mensaje || "";
    nodo.hidden = !mensaje;
    input.closest(".admin-field")?.classList.toggle("has-error", Boolean(mensaje));
    if (mensaje) input.setAttribute("aria-invalid", "true");
    else input.removeAttribute("aria-invalid");
  }

  function limpiarErrores() {
    setBanner("");
    CAMPOS.forEach((nombre) => setErrorCampo(nombre, ""));
  }

  function datosFormulario() {
    return {
      nombre: limpiar(campo("nombre")?.value),
      talla: limpiar(campo("talla")?.value).toUpperCase(),
      cantidad: Number(campo("cantidad")?.value || 1),
      notas: limpiar(campo("notas")?.value)
    };
  }

  function validar() {
    const datos = datosFormulario();
    const errores = {};
    if (datos.nombre.length < 2 || datos.nombre.length > 80) {
      errores.nombre = "Indica el nombre de la persona que recoge la camiseta.";
    }
    if (!TALLAS.has(datos.talla)) errores.talla = "Elige una talla válida.";
    if (!Number.isInteger(datos.cantidad) || datos.cantidad < 1 || datos.cantidad > 10) {
      errores.cantidad = "Puedes reservar entre 1 y 10 camisetas.";
    }
    if (datos.notas.length > 240) errores.notas = "Las notas no pueden pasar de 240 caracteres.";

    Object.entries(errores).forEach(([nombre, mensaje]) => setErrorCampo(nombre, mensaje));
    return Object.keys(errores).length === 0 ? datos : null;
  }

  form?.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limpiarErrores();

    const datos = validar();
    if (!datos) {
      setBanner("Revisa los campos marcados.");
      return;
    }

    const submit = form.querySelector("[data-admin-shirt-submit]");
    const textoOriginal = submit?.textContent;
    if (submit) {
      submit.disabled = true;
      submit.setAttribute("aria-busy", "true");
      submit.textContent = "Guardando…";
    }

    try {
      await apiJson("/api/admin/camisetas", "POST", datos);
      form.reset();
      campo("cantidad").value = "1";
      setBanner("Reserva de camiseta añadida.", "ok");
      await recargar();
    } catch (err) {
      Object.entries(err.campos || {}).forEach(([nombre, mensaje]) => setErrorCampo(nombre, mensaje));
      setBanner(err.message);
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.removeAttribute("aria-busy");
        submit.textContent = textoOriginal;
      }
    }
  });
})();
