/*
 * Álbum de jugadores (/jugadores/).
 *
 * Dos vistas sobre la misma página, como en /equipos/: la rejilla de cromos y la
 * ficha de una persona. La ficha se abre con ?j=<id> y `history.pushState`, así
 * que el enlace se puede compartir y el botón «atrás» del navegador vuelve al
 * álbum.
 *
 * Todo lo que se pinta viene de GET /api/jugadores, que nunca devuelve teléfono
 * ni correo. Aquí no se escribe nada: no hay formularios ni acciones.
 */
(() => {
  const root = document.querySelector("[data-album]");
  if (!root) return;

  const { el, iniciales } = window.CopaCromo;

  const estado = root.querySelector("[data-status]");
  const controles = root.querySelector("[data-controles]");
  const buscador = root.querySelector("[data-buscador]");
  const rejilla = root.querySelector("[data-rejilla]");
  const vacio = root.querySelector("[data-vacio]");
  const ranking = root.querySelector("[data-ranking]");
  const rankingSeccion = root.querySelector("[data-ranking-seccion]");
  const fichaWrap = root.querySelector("[data-ficha]");
  const reintentar = root.querySelector("[data-retry]");

  // Debe coincidir con METRICAS en functions/_lib/estadisticas.ts.
  const METRICAS = [
    { clave: "partidosJugados", etiqueta: "Partidos" },
    { clave: "puntos", etiqueta: "Puntos" },
    { clave: "remates", etiqueta: "Remates" },
    { clave: "bloqueos", etiqueta: "Bloqueos" },
    { clave: "aces", etiqueta: "Aces" },
    { clave: "defensas", etiqueta: "Defensas" },
    { clave: "errores", etiqueta: "Errores" }
  ];

  // Lo que se corona en el ranking. Ni partidos (no es mérito) ni errores.
  const RANKING = ["puntos", "remates", "bloqueos", "aces", "defensas"];

  // La lista de atributos no se repite aquí: se le pasa a CopaCromo el objeto
  // crudo de la API y es el cromo quien sabe sus etiquetas y abreviaturas.

  let jugadores = [];
  let edicion = null;
  let busqueda = "";

  const nombreCompleto = (j) => `${j.nombre} ${j.apellidos}`.trim();
  const sinAcentos = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  const estadoTexto = (e) =>
    e === "en_juego" ? "En juego" : e === "finalizada" ? "Finalizada" : e === "proxima" ? "Próxima" : "";

  function setEstado(mensaje, mostrarReintento = false) {
    if (estado) {
      estado.textContent = mensaje || "";
      estado.hidden = !mensaje;
    }
    if (reintentar) reintentar.hidden = !mostrarReintento;
  }

  // ------------------------------------------------------------- rejilla ----

  /**
   * El buscador es el único filtro: el término se compara también contra el
   * equipo, así que escribir su nombre hace de filtro por equipo sin una fila de
   * botones que crece con cada inscripción.
   */
  function visibles() {
    const termino = sinAcentos(busqueda.trim());
    if (!termino) return jugadores;
    return jugadores.filter((j) =>
      sinAcentos(`${nombreCompleto(j)} ${j.apodo || ""} ${j.equipoNombre}`).includes(termino)
    );
  }

  /**
   * El mini-cromo de la rejilla: metal, remate, nota y retrato.
   *
   * **Los seis atributos no entran aquí y no es un olvido.** En un móvil la
   * rejilla son dos columnas de unos 173px: dos columnas de `80 SAQ` dentro de
   * ese ancho dejan unos 70px por celda, ilegibles. La rejilla enseña el metal,
   * la nota y la posición; el desglose está a un toque, en la ficha.
   */
  function cromoMini(j) {
    const nivel = j.nivel || "bronce";
    const enlace = el("a", `album-cromo album-cromo--${nivel}`);
    enlace.href = `/jugadores/?j=${j.id}`;
    enlace.dataset.jugador = String(j.id);
    enlace.appendChild(window.CopaCromo.corona(nivel));

    const foto = el("span", "album-cromo-foto");
    if (j.tieneFoto) {
      const img = el("img");
      img.src = `/api/jugadores?foto=${j.id}`;
      img.alt = `Foto de ${nombreCompleto(j)}`;
      img.loading = "lazy";
      foto.appendChild(img);
    } else {
      // Hueco del álbum: el cromo que todavía no está pegado.
      foto.classList.add("album-cromo-foto--hueco");
      foto.appendChild(el("span", "album-cromo-inicial", iniciales(j.nombre, j.apellidos)));
      foto.appendChild(el("span", "album-cromo-pegar", "Sin cromo"));
    }

    // Sin nota no se pinta un cero: a esa persona no la han puntuado todavía.
    if (j.media != null || j.posicion) {
      const nota = el("span", "album-cromo-nota");
      if (j.media != null) nota.appendChild(el("span", "album-cromo-nota-valor", String(j.media)));
      if (j.posicion) nota.appendChild(el("span", "album-cromo-nota-pos", j.posicion));
      foto.appendChild(nota);
    }
    if (j.dorsal != null) foto.appendChild(el("span", "album-cromo-dorsal", String(j.dorsal)));
    enlace.appendChild(foto);

    const pie = el("span", "album-cromo-pie");
    pie.appendChild(el("span", "album-cromo-nombre", nombreCompleto(j)));
    pie.appendChild(el("span", "album-cromo-equipo", j.equipoNombre));
    if (j.apodo) pie.appendChild(el("span", "album-cromo-apodo", `«${j.apodo}»`));
    enlace.appendChild(pie);

    return enlace;
  }

  function renderRejilla() {
    if (!rejilla) return;
    rejilla.textContent = "";
    const lista = visibles();

    if (lista.length === 0) {
      rejilla.hidden = true;
      if (vacio) {
        vacio.hidden = false;
        vacio.textContent = jugadores.length
          ? "Ningún jugador coincide con esa búsqueda."
          : "Todavía no hay nadie inscrito en esta edición. Inscribe tu equipo y estrena el álbum.";
      }
      return;
    }

    if (vacio) vacio.hidden = true;
    rejilla.hidden = false;
    lista.forEach((j) => rejilla.appendChild(cromoMini(j)));
  }

  // ------------------------------------------------------------- ranking ----

  function renderRanking() {
    if (!ranking) return;
    ranking.textContent = "";

    const tablas = RANKING.map((clave) => {
      const metrica = METRICAS.find((m) => m.clave === clave);
      const top = jugadores
        .filter((j) => (j.estadisticas?.[clave] ?? 0) > 0)
        .sort((a, b) => b.estadisticas[clave] - a.estadisticas[clave])
        .slice(0, 3);
      return { metrica, top };
    }).filter((t) => t.top.length > 0);

    if (tablas.length === 0) {
      ranking.appendChild(
        el("p", "teams-status", "Las clasificaciones aparecen aquí en cuanto se juegue el primer partido.")
      );
      return;
    }

    const grid = el("div", "ranking-grid");
    tablas.forEach(({ metrica, top }) => {
      const card = el("article", "ranking-card");
      card.appendChild(el("h3", "ranking-titulo", metrica.etiqueta));
      const ol = el("ol", "ranking-lista");
      top.forEach((j, i) => {
        const li = el("li", "ranking-fila ranking-fila--" + ["oro", "plata", "bronce"][i]);
        const enlace = el("a", "ranking-nombre", nombreCompleto(j));
        enlace.href = `/jugadores/?j=${j.id}`;
        enlace.dataset.jugador = String(j.id);
        li.appendChild(enlace);
        li.appendChild(el("span", "ranking-valor", String(j.estadisticas[metrica.clave])));
        ol.appendChild(li);
      });
      card.appendChild(ol);
      grid.appendChild(card);
    });
    ranking.appendChild(grid);
  }

  // --------------------------------------------------------------- ficha ----

  function tilesEstadisticas(stats) {
    return METRICAS.filter((m) => (stats?.[m.clave] ?? 0) > 0).map((m) => ({
      valor: String(stats[m.clave]),
      etiqueta: m.etiqueta
    }));
  }

  function renderFicha(datos) {
    fichaWrap.textContent = "";
    const j = datos.jugador;
    const pal = datos.palmares || {};
    const carrera = tilesEstadisticas(datos.carrera);

    const volver = el("a", "album-volver", "← Volver al álbum");
    volver.href = "/jugadores/";
    volver.addEventListener("click", (event) => {
      event.preventDefault();
      history.pushState({}, "", "/jugadores/");
      mostrarAlbum();
    });
    fichaWrap.appendChild(volver);

    fichaWrap.appendChild(
      window.CopaCromo.crear({
        edicion: datos.edicion ? `${datos.edicion.nombre} · ${estadoTexto(datos.edicion.estado)}` : "La Copa Arena",
        nivel: j.nivel,
        media: j.media,
        dorsal: j.dorsal,
        nombre: nombreCompleto(j),
        apodo: j.apodo,
        posicion: j.posicion,
        equipo: j.equipoNombre,
        mano: j.mano,
        lema: j.lema,
        atributos: j.atributos,
        // Posición, equipo y mano ya tienen hueco propio en la carta.
        chips: [j.esSuplente ? "Suplente" : null],
        fotoUrl: j.tieneFoto ? `/api/jugadores?foto=${j.id}` : null,
        iniciales: iniciales(j.nombre, j.apellidos),
        bloques: [
          {
            label: "Palmarés",
            tiles: [
              { valor: String(pal.edicionesJugadas ?? 0), etiqueta: "Ediciones" },
              { valor: String(pal.podios?.oro ?? 0), etiqueta: "Oro", variante: "oro" },
              { valor: String(pal.podios?.plata ?? 0), etiqueta: "Plata", variante: "plata" },
              { valor: String(pal.podios?.bronce ?? 0), etiqueta: "Bronce", variante: "bronce" },
              { valor: pal.mejorPuesto != null ? `${pal.mejorPuesto}º` : "—", etiqueta: "Mejor puesto" }
            ]
          },
          {
            label: "En pista",
            tiles: carrera,
            texto: carrera.length ? null : "Sin estadísticas todavía."
          }
        ]
      })
    );

    if (j.instagram) {
      const social = el("p", "album-social");
      social.appendChild(el("span", null, "En redes: "));
      social.appendChild(el("strong", null, j.instagram));
      fichaWrap.appendChild(social);
    }

    fichaWrap.appendChild(historial(datos.historial || []));
  }

  function historial(entradas) {
    const panel = el("section", "teams-panel album-historial");
    panel.appendChild(el("p", "eyebrow", "Historial"));
    panel.appendChild(el("h2", null, "Sus ediciones"));

    if (entradas.length === 0) {
      panel.appendChild(el("p", "teams-status", "Aún no ha jugado ninguna edición."));
      return panel;
    }

    const lista = el("div", "historial-list");
    entradas.forEach((h) => {
      const item = el("article", "historial-item" + (h.esActual ? " historial-item--actual" : ""));

      const head = el("div", "historial-head");
      head.appendChild(el("span", "historial-anio", h.anio != null ? String(h.anio) : "—"));
      const titulos = el("div", "historial-titulos");
      titulos.appendChild(el("h3", null, h.equipoNombre));
      titulos.appendChild(el("p", "historial-sub", h.esActual ? "Edición en juego" : h.nombreEdicion || ""));
      head.appendChild(titulos);
      head.appendChild(medalla(h.posicionFinal, h.esActual));
      item.appendChild(head);

      const tiles = tilesEstadisticas(h.estadisticas);
      if (tiles.length) {
        const fila = el("div", "stat-tiles");
        tiles.forEach((t) => fila.appendChild(window.CopaCromo.statTile(t.valor, t.etiqueta)));
        item.appendChild(fila);
      }

      const companeros = h.companeros || [];
      if (companeros.length) {
        const linea = el("p", "historial-companeros");
        linea.appendChild(el("span", null, "Con "));
        companeros.forEach((c, i) => {
          if (i > 0) linea.appendChild(el("span", null, " · "));
          const enlace = el("a", "album-companero", `${c.nombre} ${c.apellidos}`.trim());
          enlace.href = `/jugadores/?j=${c.id}`;
          enlace.dataset.jugador = String(c.id);
          linea.appendChild(enlace);
        });
        item.appendChild(linea);
      }

      lista.appendChild(item);
    });

    panel.appendChild(lista);
    return panel;
  }

  function medalla(posicion, esActual) {
    if (posicion == null) {
      return el("span", "historial-puesto historial-puesto--pendiente", esActual ? "En juego" : "Sin puesto");
    }
    const variante = posicion === 1 ? "oro" : posicion === 2 ? "plata" : posicion === 3 ? "bronce" : "otro";
    return el("span", "historial-puesto historial-puesto--" + variante, `${posicion}º`);
  }

  // ------------------------------------------------------------ navegación --

  function mostrarAlbum() {
    fichaWrap.hidden = true;
    fichaWrap.textContent = "";
    if (controles) controles.hidden = jugadores.length === 0;
    rejilla.hidden = false;
    if (rankingSeccion) rankingSeccion.hidden = jugadores.length === 0;
    renderRejilla();
    document.title = "Jugadores | La Copa Arena";
  }

  async function mostrarFicha(id) {
    if (controles) controles.hidden = true;
    rejilla.hidden = true;
    if (vacio) vacio.hidden = true;
    if (rankingSeccion) rankingSeccion.hidden = true;
    fichaWrap.hidden = false;
    fichaWrap.textContent = "";
    fichaWrap.appendChild(el("p", "cromo-loading", "Buscando el cromo..."));

    try {
      const response = await fetch(`/api/jugadores?id=${encodeURIComponent(id)}`, {
        headers: { Accept: "application/json" }
      });
      const datos = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(datos.error || "No se ha podido cargar la ficha.");
      renderFicha(datos);
      document.title = `${nombreCompleto(datos.jugador)} | Jugadores | La Copa Arena`;
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err) {
      fichaWrap.textContent = "";
      fichaWrap.appendChild(el("p", "cromo-loading", err instanceof Error ? err.message : "No se ha podido cargar la ficha."));
      const volver = el("a", "album-volver", "← Volver al álbum");
      volver.href = "/jugadores/";
      fichaWrap.appendChild(volver);
    }
  }

  function idDeLaUrl() {
    const valor = new URLSearchParams(location.search).get("j");
    const id = Number(valor);
    return Number.isInteger(id) && id > 0 ? id : null;
  }

  function sincronizarConLaUrl() {
    const id = idDeLaUrl();
    if (id) mostrarFicha(id);
    else mostrarAlbum();
  }

  // Los enlaces a fichas navegan sin recargar; con Ctrl/Cmd o botón central se
  // deja pasar para que abrir en pestaña nueva siga funcionando.
  root.addEventListener("click", (event) => {
    const enlace = event.target.closest("[data-jugador]");
    if (!enlace || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    history.pushState({}, "", enlace.href);
    mostrarFicha(Number(enlace.dataset.jugador));
  });

  window.addEventListener("popstate", sincronizarConLaUrl);

  buscador?.addEventListener("input", () => {
    busqueda = buscador.value;
    renderRejilla();
  });

  reintentar?.addEventListener("click", cargar);

  // ---------------------------------------------------------------- carga ---

  async function cargar() {
    setEstado("Cargando jugadores…");
    try {
      const response = await fetch("/api/jugadores", { headers: { Accept: "application/json" } });
      const datos = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(datos.error || "No se ha podido cargar la lista de jugadores.");

      jugadores = datos.jugadores || [];
      edicion = datos.edicion;

      const titular = root.querySelector("[data-edicion]");
      if (titular && edicion) titular.textContent = `${edicion.nombre} · ${estadoTexto(edicion.estado)}`;

      const cuenta = root.querySelector("[data-cuenta]");
      if (cuenta) {
        const conFoto = jugadores.filter((j) => j.tieneFoto).length;
        cuenta.textContent = jugadores.length
          ? `${jugadores.length} jugadores · ${conFoto} con cromo`
          : "";
      }

      setEstado("");
      renderRanking();
      sincronizarConLaUrl();
    } catch (err) {
      setEstado(err instanceof Error ? err.message : "No se ha podido cargar la lista de jugadores.", true);
    }
  }

  cargar();
})();
