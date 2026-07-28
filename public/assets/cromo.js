/*
 * Cromo de jugador, compartido por «Mi zona» (/mi-equipo/) y por el álbum
 * público (/jugadores/).
 *
 * Vive aparte porque son la misma pieza vista desde dos sitios: si cada página
 * montara su propio DOM, el día que se toque el cromo se tocaría solo la mitad.
 * Aquí solo se construye el marcado; los estilos están en global.css bajo
 * «mi zona: ficha».
 *
 * Uso:
 *   CopaCromo.crear({
 *     edicion: "Copa Arena 2026 · En juego",
 *     nombre, apodo, dorsal, posicion, mano, lema,
 *     chips: ["Los Tiburones"],
 *     fotoUrl,            // si falta, se pintan las iniciales
 *     iniciales: "IG",
 *     bloques: [
 *       { label: "Palmarés", tiles: [{ valor: "2", etiqueta: "Ediciones" }] },
 *       { label: "Atributos", atributos: [{ label: "Saque", valor: 4 }] },
 *       { label: "Su juego", texto: "Todavía sin estadísticas." }
 *     ]
 *   })
 */
(() => {
  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  const iniciales = (nombre, apellidos, respaldo) => {
    const a = (nombre || "").trim()[0] || "";
    const b = (apellidos || "").trim()[0] || (respaldo || "").trim()[0] || "";
    return (a + b).toUpperCase() || "?";
  };

  function statTile(valor, etiqueta, variante) {
    const tile = el("div", "stat-tile" + (variante ? " stat-tile--" + variante : ""));
    tile.appendChild(el("span", "stat-value", valor));
    tile.appendChild(el("span", "stat-label", etiqueta));
    return tile;
  }

  function barra(label, valor) {
    const row = el("div", "atributo-row");
    row.appendChild(el("span", "atributo-label", label));
    const pips = el("span", "atributo-pips");
    pips.setAttribute("role", "img");
    pips.setAttribute("aria-label", `${label}: ${valor} de 5`);
    for (let i = 1; i <= 5; i++) {
      pips.appendChild(el("span", "pip" + (i <= valor ? " pip--on" : "")));
    }
    row.appendChild(pips);
    return row;
  }

  function bloque(datos) {
    const wrap = el("div", "cromo-block");
    if (datos.label) wrap.appendChild(el("p", "cromo-block-label", datos.label));

    if (datos.tiles?.length) {
      const tiles = el("div", "stat-tiles");
      datos.tiles.forEach((t) => tiles.appendChild(statTile(t.valor, t.etiqueta, t.variante)));
      wrap.appendChild(tiles);
    }

    if (datos.atributos?.length) {
      const bars = el("div", "atributos-view");
      datos.atributos.forEach((a) => bars.appendChild(barra(a.label, a.valor)));
      wrap.appendChild(bars);
    }

    if (datos.texto) wrap.appendChild(el("p", "cromo-hint", datos.texto));
    return wrap;
  }

  function crear(datos) {
    const card = el("article", "cromo");

    const top = el("div", "cromo-top");
    top.appendChild(el("span", "cromo-edicion", datos.edicion || "La Copa Arena"));
    if (datos.dorsal != null && datos.dorsal !== "") {
      top.appendChild(el("span", "cromo-dorsal", String(datos.dorsal)));
    }
    card.appendChild(top);

    const body = el("div", "cromo-body");

    const fotoCol = el("div", "cromo-foto-col");
    const foto = el("div", "cromo-foto");
    if (datos.fotoUrl) {
      const img = el("img");
      img.alt = `Foto de ${datos.nombre || "jugador"}`;
      img.loading = "lazy";
      img.src = datos.fotoUrl;
      foto.appendChild(img);
    } else {
      foto.appendChild(el("span", "cromo-inicial", datos.iniciales || "?"));
    }
    foto.appendChild(el("span", "cromo-sheen"));
    fotoCol.appendChild(foto);
    if (datos.posicion) fotoCol.appendChild(el("span", "cromo-posicion", datos.posicion));
    body.appendChild(fotoCol);

    const info = el("div", "cromo-info");
    info.appendChild(el("h2", "cromo-nombre", datos.nombre || "Jugador"));
    if (datos.apodo) info.appendChild(el("p", "cromo-apodo", `«${datos.apodo}»`));

    const meta = el("div", "cromo-meta");
    (datos.chips || []).forEach((texto) => {
      if (texto) meta.appendChild(el("span", "cromo-chip", texto));
    });
    if (meta.childElementCount) info.appendChild(meta);

    if (datos.lema) info.appendChild(el("p", "cromo-lema", `“${datos.lema}”`));

    (datos.bloques || []).forEach((b) => info.appendChild(bloque(b)));

    body.appendChild(info);
    card.appendChild(body);
    return card;
  }

  window.CopaCromo = { crear, el, iniciales, statTile, barra };
})();
