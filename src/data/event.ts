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

export const marqueeItems = [
  "31 Jul — 5 Ago",
  "Playa O Pozo",
  "Vóley playa",
  "La Copa Arena"
];

export const phases = [
  { label: "Fase de grupos", days: ["31 Jul", "1 Ago", "2 Ago"] },
  { label: "Fase eliminatoria", days: ["3 Ago", "4 Ago", "5 Ago"] }
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
    title: "Eventos",
    detail: "Habrá sorpresas durante el torneo."
  },
  {
    title: "Sorteos",
    detail:
      "Más detalles en nuestra cuenta de Instagram, pero ¿a quién no le apetece hacer un poco de surf en grupo?",
    link: { label: "@la_copa_arena", url: "https://www.instagram.com/la_copa_arena" }
  }
];
