export const event = {
  name: "La Copa Arena",
  claim: "El mejor campeonato de volley playa de O Pozo. Hecho para el disfrute del público.",
  dateStart: "31 Jul - 2 Ago",
  dateEnd: "7 Ago - 9 Ago",
  phases: [
    { label: "Fase de grupos", dates: "31 Jul - 2 Ago" },
    { label: "Fase final", dates: "7 Ago - 9 Ago" }
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

export const competicion = {
  fases: [
    {
      nombre: "Fase de grupos",
      fechas: event.dateStart,
      badge: "Solo 1 día obligatorio",
      puntos: [
        "Grupos de 4 equipos, todos contra todos.",
        "Pasan los 2 mejores de cada grupo, y puede que algún mejor tercero.",
        "Tu grupo juega entero el mismo día: de los 3, solo vienes 1 día obligatorio.",
        "¿Justo ese día no puedes? Pídenos la excepción y lo miramos."
      ]
    },
    {
      nombre: "Fase final",
      fechas: event.dateEnd,
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
