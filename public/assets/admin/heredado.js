// /admin/heredado/ — consulta de las tablas del formulario antiguo.
// Solo lectura: aquí no hay ninguna acción que escriba.
(() => {
  const cajaInscripciones = document.querySelector("[data-heredado-inscripciones]");
  const cajaReservas = document.querySelector("[data-heredado-reservas]");
  if (!cajaInscripciones || !window.CopaAdmin) return;

  const { api, onReady, clear, text, tabla } = window.CopaAdmin;

  const contador = (clave, n) => {
    const nodo = document.querySelector(`[data-heredado-contador="${clave}"]`);
    if (nodo) nodo.textContent = n === 1 ? "1 registro" : `${n} registros`;
  };

  const fecha = (valor) => (valor ? String(valor).slice(0, 10) : "—");

  onReady(async () => {
    const datos = await api("/api/admin/heredado");
    const inscripciones = datos.inscripciones || [];
    const reservas = datos.reservas || [];

    contador("inscripciones", inscripciones.length);
    contador("reservas", reservas.length);

    clear(cajaInscripciones);
    cajaInscripciones.append(
      tabla({
        vacio: "No queda ninguna inscripción del formulario antiguo.",
        filas: inscripciones,
        columnas: [
          { etiqueta: "#", clase: "is-num is-shrink", render: (f) => String(f.id) },
          { etiqueta: "Equipo", clase: "is-strong", render: (f) => text(f.equipo) },
          { etiqueta: "Correo", clase: "is-clip", render: (f) => text(f.email) },
          { etiqueta: "Fecha", clase: "is-num is-shrink", render: (f) => fecha(f.createdAt) }
        ]
      })
    );

    clear(cajaReservas);
    cajaReservas.append(
      tabla({
        vacio: "No queda ninguna reserva del formulario antiguo.",
        filas: reservas,
        columnas: [
          { etiqueta: "#", clase: "is-num is-shrink", render: (f) => String(f.id) },
          { etiqueta: "Nombre", clase: "is-strong", render: (f) => text(f.nombre) },
          { etiqueta: "Contacto", clase: "is-clip", render: (f) => text(f.contacto) },
          { etiqueta: "Talla", clase: "is-num is-shrink", render: (f) => text(f.talla) },
          { etiqueta: "Extras", clase: "is-clip", render: (f) => text(f.extras) },
          { etiqueta: "Fecha", clase: "is-num is-shrink", render: (f) => fecha(f.createdAt) }
        ]
      })
    );
  });
})();
