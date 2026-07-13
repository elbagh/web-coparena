export const event = {
  name: "La Copa Arena",
  claim: "El mejor campeonato de vóley playa de O Pozo. Con diferencia.",
  dateStart: "31 Jul",
  dateEnd: "5 Ago",
  location: "Playa O Pozo, Porto do Son",
  email: "copa.arena.2000@gmail.com",
  instagram: "https://www.instagram.com/la_copa_arena/"
};

export const inscripcion = {
  precio: "30 €",
  pago: "se pagan en el primer partido",
  url: "/inscripcion/",
  minJugadores: 2,
  maxJugadores: 15,
  // Site key pública de Cloudflare Turnstile. Esta es la de test (siempre
  // pasa); al crear el widget real en el dashboard de Cloudflare hay que
  // pegar aquí la site key de producción.
  turnstileSiteKey: "1x00000000000000000000AA"
};

export const socials = {
  instagram: "https://www.instagram.com/la_copa_arena",
  tiktok: "https://www.tiktok.com/@copa.arena",
  whatsapp: "https://chat.whatsapp.com/E5NjYuNemm1Egt4D6Sjv7n",
  camisetas: "https://forms.gle/srcH8rUpNCYmUxgn8"
};

// Datos de la playa: turismo.gal (recurso 10366, Pozo/Lagaño).
export const donde = {
  nombre: "Playa de O Pozo (Langaño)",
  descripcion:
    "480 metros de arena fina en la ría de Muros e Noia, entre Portosín y Porto do Son. Esta es la arena de la Copa.",
  // Embed oficial de Google Maps (sin API key): vista satélite con marcador
  // en 42°44'53.0"N 8°57'15.9"W (coordenadas de turismo.gal para la playa).
  mapaEmbed:
    "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2900!2d-8.954417!3d42.748056!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0:0x0!2zNDLCsDQ0JzUzLjAiTiA4wrA1NycxNS45Ilc!5e1!3m2!1ses!2ses",
  comoLlegarUrl: "https://www.google.com/maps/dir/?api=1&destination=42.748056,-8.954417",
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
      src: "/assets/donde-aldea-pozo.jpg",
      alt: "El arenal abierto de la playa de O Pozo, con el pinar y las casas al fondo",
      caption: "El arenal abierto a la ría, con el pinar detrás."
    }
  ],
  credito: {
    texto: "Foto: Ostiudo (CC0), vía Wikimedia Commons.",
    url: "https://commons.wikimedia.org/wiki/File:Aldea_de_o_Pozo,_Porto_do_Son.jpg"
  }
};

export const torneoInfo = [
  {
    label: "Horarios",
    title: "Tardes, cuando baja el sol",
    text: "La idea es jugar por la tarde. Los horarios finos salen cuando sepamos cuántos equipos somos."
  },
  {
    label: "Plazas",
    title: "Equipos limitados",
    text: "Habrá límite de equipos para que el torneo no se haga eterno. Cuando se llenen, cerramos."
  },
  {
    label: "Formato",
    title: "Grupos + cruces",
    text: "Primero fase de grupos y después eliminatorias. Fácil de seguir y con margen para liarla un poco."
  },
  {
    label: "Nivel",
    title: "Amateur con ganas",
    text: "No hace falta ser profesional. Sí hace falta venir con buen rollo, puntualidad y ganas de jugar."
  },
  {
    label: "Premios",
    title: "Trofeo y sorpresas",
    text: "Habrá premios para quienes lleguen arriba y sorteos para que no todo dependa del remate."
  },
  {
    label: "Inscripción",
    title: "Hasta completar plazas",
    text: "Mejor no dejarlo para el último día. Si hay hueco, entras; si no, toca animar desde fuera."
  },
  {
    label: "Normas",
    title: "Lo justo para jugar tranquilos",
    text: "Dos titulares mínimo, respeto, puntualidad y decisiones de la organización si hay dudas."
  },
  {
    label: "Después",
    title: "Te confirmamos por correo",
    text: "Al apuntarte guardamos el equipo, revisamos datos y os mandamos confirmación con lo siguiente."
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
    detailAfter: "Poco expertos en vóley playa, pero le echan ganas."
  },
  {
    title: "Sorteos",
    detail:
      "Más detalles en nuestra cuenta de Instagram, pero ¿a quién no le apetece hacer un poco de surf en grupo?",
    link: { label: "@la_copa_arena", url: "https://www.instagram.com/la_copa_arena" }
  }
];
