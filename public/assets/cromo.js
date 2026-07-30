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
 * `bloques` lo usa hoy solo /mi-equipo/, que enseña la carta sola. La ficha
 * pública de /jugadores/ pone esos números en un bocadillo al lado del cromo y
 * llama a `crear()` sin ellos, así que la carta sale más corta ahí: el despiece
 * en tres tramos es lo que permite que las dos midan distinto.
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

  const SVG_NS = "http://www.w3.org/2000/svg";

  /*
   * La carta no es un rectángulo: lleva arriba los dos cuernos de una carta
   * coleccionable y termina abajo en punta. Eso son dos SVG, uno en cada
   * extremo, con el cuerpo — el único tramo que crece con el contenido — entre
   * medias. Partirlo en tres franjas es lo que permite que una ficha con
   * palmarés y otra sin él midan distinto sin deformar ni el arco ni la punta.
   *
   * **No hay `clip-path` ni `mask` en ninguna parte, y es a propósito**: los dos
   * recortan el filo de tinta y la sombra dura desplazada, que son la casa. Aquí
   * el filo es un trazo dentro del propio SVG, y la sombra la da un
   * `drop-shadow` sobre la carta entera, que sí sigue el contorno real.
   *
   * Cada relleno se sale del viewBox por el lado que hace de costura (el remate
   * baja hasta y=80 sobre un viewBox de 80; la punta arranca en y=-6) para que
   * el recorte se coma el cierre del path y no quede junta con el cuerpo. El
   * filo se traza aparte, y solo por donde se ve.
   */
  const REMATE_FONDO =
    "M0,80 L0,15 Q0,3 12,3 L26,3 Q38,3 38,15 L38,30 Q38,41 52,44 " +
    "C104,33 196,33 248,44 Q262,41 262,30 L262,15 Q262,3 274,3 L288,3 " +
    "Q300,3 300,15 L300,80 Z";

  /*
   * Las verticales van en x=1.5 y x=298.5 para que el trazo de 3px caiga justo
   * encima de los 3px de borde lateral del cuerpo, en vez de salirse del
   * viewBox y desaparecer.
   */
  const REMATE_FILO =
    "M1.5,80 L1.5,15 Q1.5,4.5 12,4.5 L26,4.5 Q36.5,4.5 36.5,15 L36.5,30 Q36.5,40 52,43 " +
    "C104,32 196,32 248,43 Q263.5,40 263.5,30 L263.5,15 Q263.5,4.5 274,4.5 L288,4.5 " +
    "Q298.5,4.5 298.5,15 L298.5,80";

  const PUNTA_FONDO = "M0,-6 L0,14 L150,56 L300,14 L300,-6 Z";
  const PUNTA_FILO = "M1.5,-6 L1.5,13 L150,54.5 L298.5,13 L298.5,-6";

  /*
   * El nivel se reconoce por la forma además de por el color, y eso importa:
   * bronce y oro son los dos cálidos y hay quien no los distingue. La silueta
   * exterior es la misma en los tres metales, así que el que cambia es este
   * relieve dentro del arco — las siluetas del sitio, que suben con el metal:
   * la duna de la playa, el perfil de Monte Louro (el mismo ángulo que el logo
   * y que SceneHorizon) y Monte Louro con su cima.
   */
  const SKYLINE = {
    bronce: "M52,72 C96,58 128,62 150,68 C176,62 210,58 248,72 Z",
    plata: "M46,72 L104,50 L150,68 L196,50 L254,72 Z",
    oro: "M46,72 L96,46 L126,64 L150,38 L174,64 L204,46 L254,72 Z"
  };

  const nivelValido = (nivel) => (NIVELES.indexOf(nivel) >= 0 ? nivel : "bronce");

  /*
   * Un `<linearGradient>` se referencia por id, así que dos cartas en la misma
   * página no pueden compartirlo: en la rejilla del álbum hay decenas. El
   * contador es lo que evita que la segunda se pinte con el metal de la primera.
   */
  let secuencia = 0;

  function nodo(tag, atributos) {
    const n = document.createElementNS(SVG_NS, tag);
    Object.keys(atributos).forEach((k) => n.setAttribute(k, atributos[k]));
    return n;
  }

  function degradado(id) {
    const defs = nodo("defs", {});
    const grad = nodo("linearGradient", { id, x1: "0", y1: "0", x2: ".35", y2: "1" });
    [
      ["0", "var(--nivel-medio)"],
      [".42", "var(--nivel-alto)"],
      ["1", "var(--nivel-bajo)"]
    ].forEach(([offset, color]) => grad.appendChild(nodo("stop", { offset, "stop-color": color })));
    defs.appendChild(grad);
    return defs;
  }

  function placa(clase, viewBox, fondo, filo, relieve) {
    const id = `cromo-metal-${++secuencia}`;
    const svg = nodo("svg", { class: clase, viewBox, "aria-hidden": "true", focusable: "false" });
    svg.appendChild(degradado(id));
    svg.appendChild(nodo("path", { class: "cromo-placa", d: fondo, fill: `url(#${id})` }));
    if (relieve) svg.appendChild(relieve);
    svg.appendChild(nodo("path", { class: "cromo-filo", d: filo }));
    return svg;
  }

  /** El remate de la carta. Lo usan el cromo grande y el mini de la rejilla. */
  function corona(nivel) {
    const skyline = nodo("path", { class: "cromo-skyline", d: SKYLINE[nivelValido(nivel)] });
    return placa("cromo-corona", "0 0 300 80", REMATE_FONDO, REMATE_FILO, skyline);
  }

  /** La punta inferior. Va siempre en pareja con `corona`. */
  function punta() {
    return placa("cromo-punta", "0 0 300 56", PUNTA_FONDO, PUNTA_FILO, null);
  }

  /**
   * El retrato: la cara de un jugador con el metal de su cromo, para el versus
   * del directo y para la pista del anotador.
   *
   * No es el cromo ni el mini del álbum, y esa es la decisión: una carta son dos
   * SVG con su degradado cada uno, y en un versus hay dieciséis caras en
   * pantalla que además se animan al puntuar. Esto es **una `<img>` y cero
   * SVG** — el aro sale del `border`, con el metal en una variable por nivel—,
   * así que tampoco hay ids de degradado que puedan colisionar.
   *
   * Devuelve un `<span>` sin nada interactivo dentro: el anotador lo mete en un
   * `<button>` y el directo lo deja tal cual.
   *
   *   CopaCromo.retrato({
   *     nivel: "oro", dorsal: 7, media: 63,
   *     nombre: "Marta",           // null si la persona está oculta del álbum
   *     fotoUrl: "/api/jugadores?foto=12",   // null → manda el dorsal
   *     tamano: "grande" | "pequeno",
   *     prioridad: "alta",         // titular en pantalla; el resto carga en diferido
   *     etiqueta: "Marta Souto, dorsal 7"    // lo que oye un lector de pantalla
   *   })
   */
  function retrato(datos) {
    const nivel = nivelValido(datos.nivel);
    const tamano = datos.tamano === "pequeno" ? "pequeno" : "grande";
    const dorsal = datos.dorsal === 0 || datos.dorsal ? String(datos.dorsal) : "";

    const raiz = el("span", `retrato retrato--${nivel} retrato--${tamano}`);
    const marco = el("span", "retrato-marco");

    if (datos.fotoUrl) {
      const img = document.createElement("img");
      img.className = "retrato-foto";
      img.src = datos.fotoUrl;
      // El nombre ya va en texto debajo, así que la foto no lo repite: el
      // lector de pantalla lee la etiqueta de la raíz y no dos veces lo mismo.
      img.alt = "";
      // Por atributo y no por propiedad: `loading` y `decoding` no están
      // reflejados en todos los motores (jsdom, sin ir más lejos) y el atributo
      // es lo que de verdad lee el navegador.
      img.setAttribute("decoding", "async");
      // Medidas fijas para que la rejilla no salte mientras cargan.
      const lado = tamano === "grande" ? 96 : 56;
      img.setAttribute("width", String(lado));
      img.setAttribute("height", String(lado));
      img.setAttribute("loading", datos.prioridad === "alta" ? "eager" : "lazy");
      if (datos.prioridad === "alta") img.setAttribute("fetchpriority", "high");
      marco.appendChild(img);
    } else {
      /*
       * Sin foto manda el dorsal, no las iniciales: dentro de un equipo de
       * cuatro, dos iniciales identifican tanto como el nombre, y este mismo
       * hueco es el de quien ha pedido no salir en el álbum.
       */
      marco.appendChild(el("span", "retrato-hueco", dorsal || "·"));
    }
    raiz.appendChild(marco);

    if (dorsal && datos.fotoUrl) raiz.appendChild(el("span", "retrato-dorsal", dorsal));
    if (typeof datos.media === "number") raiz.appendChild(el("span", "retrato-nota", String(datos.media)));
    if (datos.nombre) raiz.appendChild(el("span", "retrato-nombre", datos.nombre));
    /*
     * El apellido, pequeño y debajo. Manda el nombre de pila —es lo que se grita
     * en la pista— pero dos «Marta» en la misma mitad eran dos botones idénticos,
     * y quien anota tiene que acertar a la primera.
     */
    if (datos.apellidos) raiz.appendChild(el("span", "retrato-apellidos", datos.apellidos));
    if (datos.etiqueta) raiz.appendChild(el("span", "sr-only", datos.etiqueta));

    return raiz;
  }

  /*
   * La sacudida de un retrato al que acaban de anotarle un punto. Vive aquí y no
   * en cada página porque las dos —el directo y el anotador— la hacen igual, y
   * porque es del retrato.
   *
   * Solo `transform`: nada que obligue al navegador a recalcular la página. Sin
   * `will-change` permanente (dieciséis capas de composición en un móvil de gama
   * baja es peor que la animación) y sin forzar reflow para reiniciarla: se
   * cancela la anterior, que es lo que hace falta cuando caen dos puntos
   * seguidos. Con `prefers-reduced-motion` no se mueve nada: destella.
   */
  const VIBRA = [
    { transform: "translate3d(0,0,0)" },
    { transform: "translate3d(-2px,0,0) rotate(-2deg)", offset: 0.2 },
    { transform: "translate3d(2px,0,0) rotate(2deg)", offset: 0.5 },
    { transform: "translate3d(-1px,0,0)", offset: 0.78 },
    { transform: "translate3d(0,0,0)" }
  ];

  function vibrar(nodo) {
    if (!nodo || !nodo.isConnected) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !nodo.animate) {
      nodo.classList.remove("is-anota");
      requestAnimationFrame(() => nodo.classList.add("is-anota"));
      setTimeout(() => nodo.classList.remove("is-anota"), 900);
      return;
    }
    nodo.getAnimations().forEach((animacion) => animacion.cancel());
    nodo.animate(VIBRA, { duration: 420, easing: "ease-out" });
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

    // Todo lo que crece con el contenido va en el cuerpo, que es el único de los
    // tres tramos con bordes laterales: remate y punta traen el suyo dentro del
    // SVG.
    const cuerpo = el("div", "cromo-cuerpo");

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
    cuerpo.appendChild(top);

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
    cuerpo.appendChild(retrato);

    // ---- identidad ----
    const identidad = el("div", "cromo-identidad");
    identidad.appendChild(el("h2", "cromo-nombre", datos.nombre || "Jugador"));
    if (datos.apodo) identidad.appendChild(el("p", "cromo-apodo", `«${datos.apodo}»`));

    const meta = el("div", "cromo-meta");
    [datos.equipo, datos.mano].concat(datos.chips || []).forEach((texto) => {
      if (texto) meta.appendChild(el("span", "cromo-chip", texto));
    });
    if (meta.childElementCount) identidad.appendChild(meta);
    cuerpo.appendChild(identidad);

    // ---- atributos ----
    cuerpo.appendChild(rejillaAtributos(datos.atributos));

    // ---- lo que es de la Copa Arena y no de una carta cualquiera ----
    const extra = el("div", "cromo-extra");
    if (datos.lema) extra.appendChild(el("p", "cromo-lema", `“${datos.lema}”`));
    (datos.bloques || []).forEach((b) => extra.appendChild(bloque(b)));
    if (extra.childElementCount) cuerpo.appendChild(extra);

    card.appendChild(cuerpo);
    card.appendChild(punta());

    return card;
  }

  window.CopaCromo = { crear, retrato, vibrar, corona, punta, el, iniciales, statTile, ATRIBUTOS, NIVELES };
})();
