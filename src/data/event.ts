export const event = {
  name: "La Copa Arena",
  claim: "El mejor campeonato de volley playa de O Pozo. Hecho para el disfrute del público.",
  // Fuente única de las fechas del torneo: las dos fases. Todo lo demás
  // (Hero, /torneo/premios/, copy de la portada, JSON-LD SportsEvent) deriva de
  // aquí para no duplicar. `startISO`/`endISO` alimentan los datos estructurados.
  //
  // Estas fechas son copy: quien manda de verdad es el calendario de `partidos`
  // en D1, que es lo que pinta /torneo/. Anunciaron «31 Jul - 2 Ago» y «7 Ago -
  // 9 Ago» durante un tiempo en el que no había ningún partido programado ni el
  // 31 ni el 7, así que la portada prometía un viernes que no existía. Al mover
  // el calendario hay que volver aquí: no hay nada que las ate solas.
  //   Grupos      A sáb 01/08 · B dom 02/08 · C jue 06/08
  //   Fase final  cuartos sáb 08/08 · semis, 3.º y final dom 09/08
  phases: [
    { label: "Fase de grupos", dates: "1 Ago - 6 Ago", startISO: "2026-08-01", endISO: "2026-08-06" },
    { label: "Fase final", dates: "8 Ago - 9 Ago", startISO: "2026-08-08", endISO: "2026-08-09" }
  ],
  location: "Playa O Pozo, Porto do Son",
  email: "copa.arena.2000@gmail.com",
  instagram: "https://www.instagram.com/la_copa_arena/"
};

export const inscripcion = {
  precio: "30 €",
  pago: "se pagan en el primer partido",
  url: "/inscripcion/",
  minJugadores: 2,
  maxJugadores: 15
};

export const socials = {
  instagram: "https://www.instagram.com/la_copa_arena",
  tiktok: "https://www.tiktok.com/@copa.arena",
  whatsapp: "https://chat.whatsapp.com/E5NjYuNemm1Egt4D6Sjv7n",
  camisetas: "/camisetas/"
};

export const camisetas = {
  precio: "15 € con reserva / 18 € sin reserva",
  pago: "se pagan al recogerlas en la playa",
  tallas: ["XS", "S", "M", "L", "XL", "XXL"],
  url: "/camisetas/"
};

// Datos de la playa: turismo.gal (recurso 10366, Pozo/Lagaño).
export const donde = {
  nombre: "Playa de O Pozo (Langaño)",
  descripcion:
    "480 metros de arena fina en la ría de Muros e Noia, entre Portosín y Porto do Son. Esta es la arena de la Copa.",
  // Coordenadas y dirección estructurada, reutilizadas por el JSON-LD (Place /
  // PostalAddress / geo) para reforzar la señal local del evento.
  coords: { lat: 42.74785, lon: -8.9554 },
  direccion: {
    streetAddress: "Praia do Pozo (Langaño), lugar de O Pozo, parroquia de Goiáns",
    postalCode: "15970",
    addressLocality: "Porto do Son",
    addressRegion: "A Coruña",
    addressCountry: "ES"
  },
  // Embed oficial de Google Maps (sin API key): vista satélite con marcador
  // en 42°44'52.3"N 8°57'19.4"W (coordenadas de dices.net para Langaño,
  // justo al lado de O Pozo).
  mapaEmbed:
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2900!2d-8.9554!3d42.74785!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0:0x0!2zNDLCsDQ0JzUyLjMiTiA4wrA1NycxOS40Ilc!5e1!3m2!1ses!2ses",
  comoLlegarUrl: "https://www.google.com/maps/dir/?api=1&destination=42.74785,-8.9554",
  llegar: [
    {
      modo: "Dirección",
      detalle:
        "Praia do Pozo (Langaño), lugar de O Pozo, parroquia de Goiáns. 15970 Porto do Son, A Coruña."
    },
    {
      modo: "En coche",
      detalle:
        "Por la AC-550 (Noia – Porto do Son). Entre Portosín y Porto do Son, toma el desvío señalizado hacia O Pozo. La playa no tiene parking propio: deja el coche en la aldea o junto a la carretera."
    },
    {
      modo: "En bus",
      detalle:
        "Línea interurbana Noia – Ribeira por la costa, con parada a unos 400 metros de la playa."
    }
  ],
  fotos: [
    {
      src: "/assets/donde-langano-1.jpg",
      alt: "Vista aérea de la cala de Langaño, con la costa rocosa y el pinar bordeando el arenal",
      caption: "La cala de Langaño desde el aire, pinar y roquedo incluidos."
    },
    {
      src: "/assets/donde-langano-2.jpg",
      alt: "Vista aérea de la playa de Langaño con arena fina entre dos puntas rocosas",
      caption: "Arena fina entre roquedos: así es Langaño desde arriba."
    }
  ]
};

export type Paso = {
  titulo: string;
  texto: string;
  link?: { label: string; url: string };
};

export const pasos: Paso[] = [
  {
    titulo: "Ficha a tu colega",
    texto:
      "Pásale esta web y convéncele: con dos personas ya hay equipo. Este es el paso difícil, el resto es cosa nuestra."
  },
  {
    titulo: "Inscribid al equipo",
    texto:
      "Rellenad la inscripción en dos minutos. Si añadís fotos y redes sociales, mejor para todos.",
    link: { label: "Inscribir equipo", url: "/inscripcion/" }
  },
  {
    titulo: "Entráis al WhatsApp",
    texto:
      "Os añadimos a los grupos para que sepáis qué días os toca venir. Cualquier duda: MD a Instagram, correo o el propio grupo."
  },
  {
    titulo: "El día del torneo",
    texto:
      "Trae a tus familiares, amigos, enemigos... Esto es un espectáculo y cada año va a más."
  }
];

export type PerkPerson = {
  handle: string;
  url: string;
  photo: string;
};

export type Perk = {
  title: string;
  detail: string;
  detailAfter?: string;
  link?: { label: string; url: string };
  people?: PerkPerson[];
};

export const perks: Perk[] = [
  {
    title: "DJ en directo",
    detail: "Uno de los mejores DJ de la zona.",
    link: { label: "@sot0mmyy", url: "https://www.instagram.com/sot0mmyy" }
  },
  {
    title: "Bebida",
    detail: "Mejor pregunta al llegar... pero de todo."
  },
  {
    title: "Comentaristas",
    detail: "Expertos en la salud.",
    people: [
      {
        handle: "@podomanu",
        url: "https://www.instagram.com/podomanu",
        photo: "/assets/comentarista-podomanu.png"
      },
      {
        handle: "@ramonru97",
        url: "https://www.instagram.com/ramonru97",
        photo: "/assets/comentarista-ramonru97.png"
      }
    ],
    detailAfter: "Poco expertos en volley playa, pero le echan ganas."
  },
  {
    title: "Sorteos",
    detail:
      "Más detalles en nuestra cuenta de Instagram, pero ¿a quién no le apetece hacer un poco de surf en grupo?",
    link: { label: "@la_copa_arena", url: "https://www.instagram.com/la_copa_arena" }
  }
];

// ------------------------------ Premios y Competición ------------------------------
// Todo el bote (100% de lo recaudado) se reparte en premios. El reparto en metálico
// suma 90% (50/25/15 + el 4º honorífico) y el 10% restante va a los premios
// secundarios, que se entregan en especie. `alt` es el alto relativo del escalón en
// el podio (1 = el más alto); solo lo usan el 1º, 2º y 3º.
export type PremioTier = {
  puesto: string;
  titulo: string;
  pct?: string;
  alt?: number;
  detalle: string;
};

export const premios: PremioTier[] = [
  {
    puesto: "1º",
    titulo: "Campeones",
    pct: "50%",
    alt: 1,
    detalle: "La mitad de todo lo recaudado, el trofeo de La Copa Arena y la gloria hasta el año que viene."
  },
  {
    puesto: "2º",
    titulo: "Finalistas",
    pct: "25%",
    alt: 0.66,
    detalle: "Un cuarto del bote para el equipo que se quedó a un paso."
  },
  {
    puesto: "3º",
    titulo: "Bronce",
    pct: "15%",
    alt: 0.46,
    detalle: "Un 15% del bote y medallas para cerrar el podio."
  },
  {
    puesto: "4º",
    titulo: "Las gracias",
    detalle: "Sin premio en metálico, pero con nuestro cariño y un buen aplauso de la grada."
  }
];

export type PremioSecundario = {
  titulo: string;
  detalle: string;
};

// Se llevan el 10% restante del bote, repartido en especie (no en dinero).
export const premiosSecundarios: PremioSecundario[] = [
  {
    titulo: "Rey del muro",
    detalle: "Para quien meta más bloqueos en toda la Copa."
  },
  {
    titulo: "Favorito del público",
    detalle: "Al equipo o jugador que se meta a la grada en el bolsillo."
  },
  {
    titulo: "Saque de época",
    detalle: "Al saque más espectacular del torneo."
  },
  {
    titulo: "…y más",
    detalle: "Iremos anunciando categorías sorpresa por Instagram."
  }
];

export type Fase = {
  nombre: string;
  fechas: string;
  badge?: string;
  puntos: string[];
};

export type Regla = {
  titulo: string;
  detalle: string;
  pirata?: boolean;
};

/**
 * La puntuación de la fase de grupos, tal y como se le cuenta al público.
 *
 * Es copia, igual que `event.phases`: las reglas que de verdad rigen viven en
 * `torneo_fases.reglas` / `torneo_grupos.reglas` en D1 y se editan desde
 * /admin/torneo/. Si allí se cambian los valores, hay que volver aquí a mano —
 * no hay nada que ate las dos cosas. Hoy coinciden con la fase de grupos de la
 * edición en curso (3 / 2 / 1 / 0) y con el grupo C, que juega a un set.
 */
export const puntuacion = {
  titulo: "Cómo se puntúa en los grupos",
  intro:
    "En la fase de grupos cada partido reparte puntos a los dos equipos. No decide solo quién gana: también cuenta si el partido se resuelve en dos sets o llega al tercero.",
  columnas: ["En 2 sets", "En 3 sets"],
  filas: [
    {
      resultado: "Ganas",
      casillas: [
        { marcador: "2–0", puntos: 3 },
        { marcador: "2–1", puntos: 2 }
      ]
    },
    {
      resultado: "Pierdes",
      casillas: [
        { marcador: "0–2", puntos: 0 },
        { marcador: "1–2", puntos: 1 }
      ]
    }
  ],
  nota: "El tercer set cambia el reparto: quien gana se lleva 2 en vez de 3, y quien pierde se lleva 1 en vez de 0.",
  ejemplo: {
    texto: "Por eso ganar los tres partidos del grupo no siempre son 9 puntos. Dos victorias en dos sets y una en el tercero suman:",
    cuenta: "3 + 3 + 2 = 8"
  },
  excepcion: "El grupo C se juega a un set. Allí ganar son 3 puntos y perder, 0.",
  desempates: {
    texto: "Si dos equipos acaban con los mismos puntos, se miran en este orden:",
    criterios: [
      "El partido entre ellos.",
      "Ratio de sets ganados y perdidos.",
      "Ratio de puntos a favor y en contra."
    ]
  }
};

/**
 * El aviso que explica por qué la tabla de un grupo no se lee como de costumbre.
 *
 * Es copia escrita a mano, como `puntuacion`: quien manda de verdad es la
 * columna `torneo_grupo_equipos.retirado` en D1, que es la que pinta el gris y
 * la que reparte las plazas. Esto solo lo cuenta con palabras. Va en el marcado
 * estático de /torneo/ y no en JavaScript, así que sigue ahí si /api/torneo
 * falla — que es justo cuando alguien necesita entender la tabla.
 *
 * `equipos` lleva los nombres tal y como están en la base, para que las fichas
 * del aviso y las filas de la tabla digan lo mismo.
 */
export const avisoTorneo = {
  eyebrow: "Cambio en el cuadro",
  titulo: "Limens no juega la eliminatoria",
  equipos: { fuera: "Limens", dentro: "Croquetillas de Arena" },
  parrafos: [
    "Limens se clasificó segundo del grupo B, pero no puede competir el fin de semana de la fase eliminatoria. Su plaza pasa a Croquetillas de Arena, tercero del grupo B.",
    "Con esa plaza resuelta, la repesca ya no se disputa. Pasan los tres primeros del grupo A y Calvos de Orion se asegura el puesto."
  ]
};

export const competicion = {
  fases: [
    {
      nombre: event.phases[0].label,
      fechas: event.phases[0].dates,
      badge: "Solo 1 día obligatorio",
      puntos: [
        "Grupos de 4 equipos, todos contra todos.",
        "Pasan los 2 mejores de cada grupo, y puede que algún mejor tercero.",
        "Tu grupo juega entero el mismo día: de los 3, solo vienes 1 día obligatorio.",
        "¿Justo ese día no puedes? Pídenos la excepción y lo miramos."
      ]
    },
    {
      nombre: event.phases[1].label,
      fechas: event.phases[1].dates,
      puntos: [
        "Eliminatorias directas: se gana o a casa.",
        "Si tu equipo sigue pasando rondas, vuelves los días siguientes.",
        "Cuanto más avanzas, más cerca del 50%. Vale la pena."
      ]
    }
  ] as Fase[],
  reglas: [
    {
      titulo: "Equipos de 2 + suplentes",
      detalle:
        "Se juega de dos en dos, pero podéis traer varios suplentes para turnaros. Todos pagan lo mismo: 30 €."
    },
    {
      titulo: "Equilibrio (modo pirata)",
      detalle:
        "Si un equipo trae un nivelón de escándalo, la organización se reserva el derecho a ser un poco pirata para equilibrar el cuadro. Cuidado con quién te apuntas…",
      pirata: true
    }
  ] as Regla[]
};
