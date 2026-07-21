export const site = {
  url: "https://lacoparena.es",
  name: "La Copa Arena",
  defaultTitle: "La Copa Arena | Volley playa en Playa O Pozo",
  defaultDescription:
    "La Copa Arena: torneo informal de volley playa en Playa O Pozo, Porto do Son. Fase de grupos del 31 de julio al 2 de agosto y fase final del 7 al 9 de agosto.",
  defaultImage: "/assets/copa-arena-hero.png",
  locale: "es_ES"
};

// Perfiles oficiales de la marca. Se usan como `sameAs` en el JSON-LD de la
// portada para que Google consolide la entidad "La Copa Arena".
export const sameAs = [
  "https://www.instagram.com/la_copa_arena/",
  "https://www.tiktok.com/@copa.arena",
  "https://linktr.ee/la.copa.arena"
];

export const publicPages = [
  { path: "/", priority: "1.0" },
  { path: "/inscripcion/", priority: "0.9" },
  { path: "/donde-estamos/", priority: "0.8" },
  { path: "/competicion/", priority: "0.8" },
  { path: "/equipos/", priority: "0.7" },
  { path: "/camisetas/", priority: "0.7" },
  { path: "/privacidad/", priority: "0.2" },
  { path: "/cookies/", priority: "0.2" },
  { path: "/aviso-legal/", priority: "0.2" }
];

export const absoluteUrl = (path: string) => new URL(path, site.url).toString();
