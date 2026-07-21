import type { APIRoute } from "astro";
import { publicPages, absoluteUrl } from "../data/seo";

// Sitemap generado desde `publicPages` (única fuente de verdad en seo.ts) para
// que no vuelva a desincronizarse. Endpoint prerenderizado en el build estático.
export const GET: APIRoute = () => {
  const lastmod = new Date().toISOString().slice(0, 10);

  const urls = publicPages
    .map(
      ({ path, priority, changefreq }) => `  <url>
    <loc>${absoluteUrl(path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`
    )
    .join("\n");

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;

  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8" }
  });
};
