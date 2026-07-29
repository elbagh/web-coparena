/*
 * Cromo de jugador, compartido por «Mi zona» (/mi-equipo/) y por el álbum
 * público (/jugadores/).
 *
 * Vive aparte porque son la misma pieza vista desde dos sitios: si cada página
 * montara su propio DOM, el día que se toque el cromo se tocaría solo la mitad.
 * Aquí solo se construye el marcado; los estilos están en global.css bajo
 * «cromo de jugador».
 *
 * **Anatomía de carta coleccionable**: remate superior, nota global con la
 * posición debajo, retrato, nombre, y los seis atributos en rejilla 2×3. Los
 * bloques propios de la Copa Arena (palmarés, «en pista») van al final, fuera
 * de esa anatomía.
 *
 * Uso:
 *   CopaCromo.crear({
 *     nivel: "oro",              // "bronce" | "plata" | "oro"; por defecto bronce
 *     media: 80,                 // 1–99, o null: entonces la carta sale sin nota
 *     nombre, apodo, dorsal, posicion, mano, equipo, lema,
 *     edicion: "Copa Arena 2026 · En juego",
 *     fotoUrl,                   // si falta, se pintan las iniciales
 *     iniciales: "IG",
 *     atributos: { saque: 80, remate: 60 },   // objeto crudo de la API
 *     chips: ["Suplente"],       // lo que no tiene hueco propio
 *     bloques: [
 *       { label: "Palmarés", tiles: [{ valor: "2", etiqueta: "Ediciones" }] },
 *       { label: "En pista", texto: "Todavía sin estadísticas." }
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

  /*
   * Debe coincidir con ATRIBUTOS en functions/_lib/perfil.ts. Se repite a mano
   * porque este fichero se carga con <script is:inline> y no puede importar del
   * servidor; test/unit/paridad-validacion.test.ts falla si divergen.
   *
   * Las abreviaturas viven aquí, y solo aquí, porque solo el cromo las pinta.
   */
  const ATRIBUTOS = [
    { clave: "saque", etiqueta: "Saque", abrev: "SAQ" },
    { clave: "remate", etiqueta: "Remate", abrev: "REM" },
    { clave: "bloqueo", etiqueta: "Bloqueo", abrev: "BLO" },
    { clave: "defensa", etiqueta: "Defensa", abrev: "DEF" },
    { clave: "recepcion", etiqueta: "Recepción", abrev: "REC" },
    { clave: "colocacion", etiqueta: "Colocación", abrev: "COL" }
  ];

  const NIVELES = ["bronce", "plata", "oro"];

  /*
   * El remate superior de la carta, distinto por nivel. No es la muesca de FIFA
   * calcada: son las siluetas del sitio, que suben con el metal — la duna de la
   * playa, el perfil de Monte Louro (el mismo ángulo que el logo y que
   * SceneHorizon) y Monte Louro con su cima. Así el nivel se reconoce por la
   * forma además de por el color.
   *
   * Las verticales van en x=1.5 y x=298.5 para que el trazo de 3px caiga justo
   * encima de los 3px de borde lateral de la carta, en vez de salirse del
   * viewBox y desaparecer. El fondo del path baja hasta y=64, por debajo del
   * viewBox (54), para que el recorte se coma el cierre y no quede costura.
   */
  const CORONAS = {
    bronce:
      "M1.5,64 L1.5,42 Q3,27 22,26 C62,17 108,22 133,35 Q150,43 167,35 C192,22 238,17 278,26 Q297,27 298.5,42 L298.5,64 Z",
    plata: "M1.5,64 L1.5,38 L22,20 L86,6 L150,48 L214,6 L278,20 L298.5,38 L298.5,64 Z",
    oro: "M1.5,64 L1.5,38 L22,20 L86,4 L126,42 L150,10 L174,42 L214,4 L278,20 L298.5,38 L298.5,64 Z"
  };

  const nivelValido = (nivel) => (NIVELES.indexOf(nivel) >= 0 ? nivel : "bronce");

  /** El remate de la carta. Lo usan el cromo grande y el mini de la rejilla. */
  function corona(nivel) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "cromo-corona");
    svg.setAttribute("viewBox", "0 0 300 54");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", CORONAS[nivelValido(nivel)]);
    svg.appendChild(path);
    return svg;
  }

  function statTile(valor, etiqueta, variante) {
    const tile = el("div", "stat-tile" + (variante ? " stat-tile--" + variante : ""));
    tile.appendChild(el("span", "stat-value", valor));
    tile.appendChild(el("span", "stat-label", etiqueta));
    return tile;
  }

  function bloque(datos) {
    const wrap = el("div", "cromo-block");
    if (datos.label) wrap.appendChild(el("p", "cromo-block-label", datos.label));

    if (datos.tiles?.length) {
      const tiles = el("div", "stat-tiles");
      datos.tiles.forEach((t) => tiles.appendChild(statTile(t.valor, t.etiqueta, t.variante)));
      wrap.appendChild(tiles);
    }

    if (datos.texto) wrap.appendChild(el("p", "cromo-hint", datos.texto));
    return wrap;
  }

  /**
   * Los seis atributos en dos columnas de tres. Se pintan **siempre los seis**,
   * con un guión en los que no están puntuados: una carta tiene seis casillas, y
   * una rejilla desigual se lee peor que una con huecos.
   */
  function rejillaAtributos(valores) {
    const grid = el("div", "cromo-stats");
    ATRIBUTOS.forEach((atributo) => {
      const valor = valores?.[atributo.clave];
      const puntuado = typeof valor === "number";

      const celda = el("div", "cromo-stat" + (puntuado ? "" : " cromo-stat--vacio"));
      celda.appendChild(el("span", "cromo-stat-valor", puntuado ? String(valor) : "—"));

      // La abreviatura se lee en tres letras; el nombre entero queda para quien
      // pase el ratón y para los lectores de pantalla.
      const clave = el("span", "cromo-stat-clave", atributo.abrev);
      clave.title = atributo.etiqueta;
      celda.appendChild(clave);

      celda.appendChild(
        el("span", "sr-only", puntuado ? `${atributo.etiqueta}: ${valor} de 99` : `${atributo.etiqueta}: sin puntuar`)
      );
      grid.appendChild(celda);
    });
    return grid;
  }

  function crear(datos) {
    const nivel = nivelValido(datos.nivel);
    const card = el("article", `cromo cromo--${nivel}`);
    if (datos.media == null) card.classList.add("cromo--sin-nota");

    card.appendChild(corona(nivel));
    // El metal se ve en el color y en la forma; esto es lo que lo dice a quien
    // no ve ninguna de las dos cosas.
    card.appendChild(el("span", "sr-only", `Cromo de nivel ${nivel}`));

    // ---- cabecera: nota, posición, edición y dorsal ----
    const top = el("header", "cromo-top");

    const nota = el("div", "cromo-nota");
    // Sin ningún atributo puntuado no se inventa un cero: falta la cifra y ya.
    if (datos.media != null) nota.appendChild(el("span", "cromo-nota-valor", String(datos.media)));
    if (datos.posicion) nota.appendChild(el("span", "cromo-nota-pos", datos.posicion));
    if (nota.childElementCount) top.appendChild(nota);

    const marca = el("div", "cromo-marca");
    marca.appendChild(el("span", "cromo-edicion", datos.edicion || "La Copa Arena"));
    if (datos.dorsal != null && datos.dorsal !== "") {
      marca.appendChild(el("span", "cromo-dorsal", String(datos.dorsal)));
    }
    top.appendChild(marca);
    card.appendChild(top);

    // ---- retrato ----
    const retrato = el("div", "cromo-retrato");
    if (datos.fotoUrl) {
      const img = el("img");
      img.alt = `Foto de ${datos.nombre || "jugador"}`;
      img.loading = "lazy";
      img.src = datos.fotoUrl;
      retrato.appendChild(img);
    } else {
      retrato.appendChild(el("span", "cromo-inicial", datos.iniciales || "?"));
    }
    retrato.appendChild(el("span", "cromo-sheen"));
    card.appendChild(retrato);

    // ---- identidad ----
    const identidad = el("div", "cromo-identidad");
    identidad.appendChild(el("h2", "cromo-nombre", datos.nombre || "Jugador"));
    if (datos.apodo) identidad.appendChild(el("p", "cromo-apodo", `«${datos.apodo}»`));

    const meta = el("div", "cromo-meta");
    [datos.equipo, datos.mano].concat(datos.chips || []).forEach((texto) => {
      if (texto) meta.appendChild(el("span", "cromo-chip", texto));
    });
    if (meta.childElementCount) identidad.appendChild(meta);
    card.appendChild(identidad);

    // ---- atributos ----
    card.appendChild(rejillaAtributos(datos.atributos));

    // ---- lo que es de la Copa Arena y no de una carta cualquiera ----
    const extra = el("div", "cromo-extra");
    if (datos.lema) extra.appendChild(el("p", "cromo-lema", `“${datos.lema}”`));
    (datos.bloques || []).forEach((b) => extra.appendChild(bloque(b)));
    if (extra.childElementCount) card.appendChild(extra);

    return card;
  }

  window.CopaCromo = { crear, corona, el, iniciales, statTile, ATRIBUTOS, NIVELES };
})();
