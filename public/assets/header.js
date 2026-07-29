/*
 * Comportamiento de la cabecera: cerrar lo que se despliega en ella. Hoy son dos
 * cosas, el desplegable de «Torneo» y el aviso del chip del directo apagado.
 *
 * Los dos son <details>, igual que el menú móvil, así que abren y cierran sin
 * JavaScript. Lo que falta sin JS es lo que <details> no hace solo: cerrarse al
 * pulsar fuera y con Escape. Eso es todo lo que añade este fichero — si no carga,
 * siguen funcionando. Por eso basta con marcar con `data-nav-drop` cualquier
 * cosa nueva que se despliegue en la cabecera.
 */
(() => {
  const desplegables = () => Array.from(document.querySelectorAll("[data-nav-drop]"));
  if (desplegables().length === 0) return;

  const cerrarTodos = (salvo) => {
    desplegables().forEach((detalle) => {
      if (detalle !== salvo) detalle.open = false;
    });
  };

  // Abrir uno cierra los demás, para no dejar dos paneles solapados.
  desplegables().forEach((detalle) => {
    detalle.addEventListener("toggle", () => {
      if (detalle.open) cerrarTodos(detalle);
    });
  });

  document.addEventListener("click", (evento) => {
    const dentro = evento.target instanceof Element && evento.target.closest("[data-nav-drop]");
    if (!dentro) cerrarTodos(null);
  });

  document.addEventListener("keydown", (evento) => {
    if (evento.key !== "Escape") return;
    const abierto = desplegables().find((detalle) => detalle.open);
    if (!abierto) return;
    abierto.open = false;
    // El foco vuelve al disparador: quien navega con teclado no debe perderlo.
    abierto.querySelector("summary")?.focus();
  });
})();
