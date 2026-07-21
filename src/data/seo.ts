export const site = {
  url: "https://lacoparena.es",
  name: "La Copa Arena",
  defaultTitle: "La Copa Arena | Volley playa en Playa O Pozo",
  defaultDescription:
    "La Copa Arena: torneo informal de volley playa en Playa O Pozo, Porto do Son. Fase de grupos del 31 de julio al 2 de agosto y fase final del 7 al 9 de agosto.",
  // Card social 1200x630 optimizado (< 300 KB) para Open Graph / Twitter.
  defaultImage: "/assets/copa-arena-og.jpg",
  imageWidth: 1200,
  imageHeight: 630,
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
  { path: "/", priority: "1.0", changefreq: "weekly" },
  { path: "/inscripcion/", priority: "0.9", changefreq: "weekly" },
  { path: "/donde-estamos/", priority: "0.8", changefreq: "monthly" },
  { path: "/competicion/", priority: "0.8", changefreq: "monthly" },
  { path: "/equipos/", priority: "0.7", changefreq: "daily" },
  { path: "/camisetas/", priority: "0.7", changefreq: "monthly" },
  { path: "/privacidad/", priority: "0.2", changefreq: "yearly" },
  { path: "/cookies/", priority: "0.2", changefreq: "yearly" },
  { path: "/aviso-legal/", priority: "0.2", changefreq: "yearly" }
];

export const absoluteUrl = (path: string) => new URL(path, site.url).toString();

// Genera un BreadcrumbList JSON-LD a partir de una ruta de migas
// (Inicio siempre primero). Refuerza la estructura del sitio en el SERP.
export const breadcrumb = (items: { name: string; path: string }[]) => ({
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  itemListElement: [{ name: "Inicio", path: "/" }, ...items].map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: item.name,
    item: absoluteUrl(item.path)
  }))
});
