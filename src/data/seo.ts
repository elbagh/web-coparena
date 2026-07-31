import { event } from "./event";

const MESES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"
];

/**
 * «del 1 al 3 de agosto», sacado de las fechas ISO de la fase.
 *
 * Sale de `startISO`/`endISO` y no de `dates` («1 Ago - 3 Ago») porque aquella
 * cadena es un rótulo para la portada: cambiarle el formato no debe reescribir
 * lo que Google enseña en los resultados.
 *
 * Y se deriva en vez de escribirse a mano porque la descripción llevaba meses
 * anunciando «del 31 de julio al 2 de agosto», fechas que ya no existían en
 * ninguna otra parte del sitio. Una frase que nadie mira al cambiar el
 * calendario es una frase que se queda vieja.
 */
const rango = (fase: { startISO: string; endISO: string }): string => {
  const dia = (iso: string) => Number(iso.slice(8, 10));
  const mes = (iso: string) => MESES[Number(iso.slice(5, 7)) - 1];
  return mes(fase.startISO) === mes(fase.endISO)
    ? `del ${dia(fase.startISO)} al ${dia(fase.endISO)} de ${mes(fase.endISO)}`
    : `del ${dia(fase.startISO)} de ${mes(fase.startISO)} al ${dia(fase.endISO)} de ${mes(fase.endISO)}`;
};

export const site = {
  url: "https://lacoparena.es",
  name: "La Copa Arena",
  defaultTitle: "La Copa Arena | Volley playa en Playa O Pozo",
  defaultDescription:
    `La Copa Arena: torneo informal de volley playa en Playa O Pozo, Porto do Son. ` +
    `Fase de grupos ${rango(event.phases[0])} y fase final ${rango(event.phases[1])}.`,
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
  { path: "/torneo/", priority: "0.9", changefreq: "daily" },
  { path: "/directo/", priority: "0.9", changefreq: "daily" },
  { path: "/torneo/premios/", priority: "0.8", changefreq: "monthly" },
  { path: "/equipos/", priority: "0.7", changefreq: "daily" },
  { path: "/jugadores/", priority: "0.7", changefreq: "daily" },
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
