/*
 * /anotador/ — qué partido voy a llevar.
 *
 * Lo que se está jugando va primero: es lo que busca quien llega con el móvil en
 * la mano y el partido ya empezado.
 */
(() => {
  const raiz = document.querySelector("[data-anot-lista]");
  if (!raiz || !window.CopaAnotador) return;

  const { api, setError, alEntrar } = window.CopaAnotador;
  const vacio = raiz.querySelector("[data-anot-lista-vacio]");

  const el = (tag, clase, texto) => {
    const nodo = document.createElement(tag);
    if (clase) nodo.className = clase;
    if (texto !== undefined) nodo.textContent = texto;
    return nodo;
  };

  const hora = (valor) =>
    valor
      ? new Intl.DateTimeFormat("es", { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(valor))
      : "Sin hora";

  function tarjeta(partido) {
    const enlace = el("a", `anot-partido is-${partido.status}`);
    enlace.href = `/anotador/partido/?id=${encodeURIComponent(partido.id)}`;

    const meta = el("div", "anot-partido-meta");
    meta.append(el("span", "", partido.ronda));
    /*
     * La hora, no la pista. Enseñaba `pista || hora`, y como todos los partidos
     * del torneo se juegan en la misma pista, los treinta ponían «Pista central»:
     * una columna idéntica en todas las tarjetas, ocupando el sitio del único dato
     * que distingue un partido del siguiente.
     */
    meta.append(el("span", "", hora(partido.scheduledAt)));
    if (partido.status === "live") meta.append(el("span", "anot-vivo", "En juego"));
    enlace.append(meta);

    const cruce = el("div", "anot-partido-cruce");
    cruce.append(
      el("span", "anot-partido-equipo", partido.teams.A.name || "Por decidir"),
      el("span", "anot-partido-tanteo", `${partido.points.A}–${partido.points.B}`),
      el("span", "anot-partido-equipo", partido.teams.B.name || "Por decidir")
    );
    enlace.append(cruce);

    // Que ya lo lleve alguien no lo bloquea, pero conviene saberlo antes de entrar.
    if (partido.origenMarcador === "eventos") {
      enlace.append(el("p", "anot-partido-nota", "Ya se está anotando"));
    }
    return enlace;
  }

  alEntrar(async () => {
    try {
      const datos = await api("/api/anotacion");
      const partidos = datos.partidos || [];

      raiz.textContent = "";
      if (partidos.length === 0) {
        raiz.append(el("p", "anot-vacio", "No hay ningún partido pendiente en esta edición."));
        return;
      }
      partidos.forEach((partido) => raiz.append(tarjeta(partido)));
    } catch (error) {
      if (vacio) vacio.textContent = "";
      setError(error.message);
    }
  });
})();
