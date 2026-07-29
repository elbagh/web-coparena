# La Copa Arena

Web en Astro para La Copa Arena, con Cloudflare Workers para inscripciones, login con Google y gestión privada de equipos y camisetas.

## Desarrollo

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Despliegue en Cloudflare Workers

En el proyecto de Cloudflare Workers Builds:

- Build command: `npm run build`
- Deploy command: `npm run deploy:worker`
- Root directory: `/`

El build de Astro genera `dist/`. El deploy compila las funciones de `functions/` a `.worker/` y ejecuta `wrangler deploy`, usando `dist/` como assets estáticos del Worker.

**El Deploy command tiene que ser `npm run deploy:worker`, no `npx wrangler deploy`.** Es lo único que hace correr `predeploy:worker`, que aplica las migraciones pendientes de D1 antes de subir el código. Con el comando por defecto, npm no ejecuta el hook: el deploy sale verde y el esquema se queda atrás, sin un solo aviso.

### Promocionar a producción

Un deploy sube código, no esquema. Cualquier merge a `main` va precedido de las migraciones, siempre:

```bash
npm run db:status    # qué le falta a producción
npm run db:migrate   # aplicarlo, ANTES de que suba el código
# merge development -> main y push
npm run db:status    # tiene que decir "No migrations to apply!"
```

Las migraciones van primero para que, durante los segundos que dura el deploy, el código viejo que aún sirve tráfico se encuentre un esquema que es un superconjunto del que conoce. Por eso todas son aditivas y por eso una columna solo se borra un despliegue después de que el código deje de leerla.

Si despliegas por CLI:

```bash
npm run deploy
```

## Recursos de Cloudflare

```bash
npx wrangler d1 create copa-arena-db
npx wrangler r2 bucket create copa-arena-fotos
```

El binding de D1 debe llamarse `DB` y el bucket R2 debe llamarse `FOTOS`.

Aplica las migraciones. El destino va explícito: sin bandera es fácil dejar producción atrás creyendo lo contrario.

```bash
npx wrangler d1 migrations apply copa-arena-db --local    # base de desarrollo
npm run db:migrate                                        # producción
```

## Variables y secrets

Configura en Cloudflare Workers:

- `GOOGLE_CLIENT_ID`: ID de cliente OAuth de Google, tipo Web.
- `PUBLIC_GOOGLE_CLIENT_ID`: opcional, mismo valor que `GOOGLE_CLIENT_ID`. Sirve como fallback de build para que el botón de Google pueda pintarse aunque la config dinámica llegue vacía.
- `SESSION_SECRET`: cadena larga y aleatoria para firmar la sesión.
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`

En Google Cloud Console, el cliente OAuth debe permitir el dominio de producción del Worker y el dominio preview si quieres probar login en previews.

## Notas

- `npm run build:site` valida Astro. En Cloudflare, `npm run build` genera `.worker/index.js` antes del deploy.
- `dist/` y `.worker/` no se commitean; Cloudflare los genera durante el build/deploy.
- Cada cuenta de Google solo puede tener un equipo asociado.
- Las reservas de camisetas quedan ligadas a la cuenta de Google y se consultan desde Mi zona.
- El panel `/admin/` no está enlazado públicamente y solo carga datos si la cuenta tiene un rol con los
  permisos correspondientes. Los roles se gestionan desde `/admin/roles/`, pero el **primero** hay que
  darlo a mano, porque hasta que exista un administrador no hay quien reparta permisos:

```sql
UPDATE usuarios SET rol_id = (SELECT id FROM roles WHERE clave = 'admin')
 WHERE email = 'tu-correo@gmail.com';
```

  A partir de ahí, todo lo demás (crear roles, asignarlos) se hace desde el panel. La columna
  `usuarios.is_admin`, que era la forma vieja de marcar quién entraba, **ya no existe**: la retiró la
  migración 0022, una vez producción llevó un despliegue en el que nadie la leía.
