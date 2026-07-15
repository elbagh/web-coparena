export const site = {
  url: "https://lacoparena.es",
  name: "La Copa Arena",
  defaultTitle: "La Copa Arena | Volley playa en Playa O Pozo",
  defaultDescription:
    "La Copa Arena: torneo informal de volley playa en Playa O Pozo, Porto do Son. Del 31 de julio al 2 de agosto y del 7 al 9 de agosto.",
  defaultImage: "/assets/copa-arena-hero.png",
  locale: "es_ES"
};

export const publicPages = [
  { path: "/", priority: "1.0" },
  { path: "/inscripcion/", priority: "0.9" },
  { path: "/donde-estamos/", priority: "0.8" },
  { path: "/equipos/", priority: "0.7" },
  { path: "/camisetas/", priority: "0.7" },
  { path: "/privacidad/", priority: "0.2" },
  { path: "/cookies/", priority: "0.2" },
  { path: "/aviso-legal/", priority: "0.2" }
];

export const absoluteUrl = (path: string) => new URL(path, site.url).toString();
