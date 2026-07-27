// /admin/ — cifras de un vistazo, cada una enlazando a su sección.
(() => {
  const raiz = document.querySelector("[data-admin-resumen]");
  if (!raiz || !window.CopaAdmin) return;

  const { el, resumen, onReady, clear } = window.CopaAdmin;

  onReady(async () => {
    const datos = await resumen();
    const cifras = [
      ["Equipos", datos.stats?.equipos ?? 0, "/admin/equipos/"],
      ["Jugadores", datos.stats?.jugadores ?? 0, "/admin/equipos/"],
      ["Camisetas", datos.stats?.camisetas ?? 0, "/admin/camisetas/"],
      ["Reservas", datos.stats?.reservasCamisetas ?? 0, "/admin/camisetas/"]
    ];

    clear(raiz);
    cifras.forEach(([etiqueta, valor, href]) => {
      const tarjeta = document.createElement("a");
      tarjeta.className = "admin-stat";
      tarjeta.href = href;
      tarjeta.append(el("strong", "", valor));
      tarjeta.append(el("span", "", etiqueta));
      raiz.append(tarjeta);
    });
  });
})();
