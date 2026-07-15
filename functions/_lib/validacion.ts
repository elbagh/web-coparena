// Validación y normalización del registro de equipos.
// La normalización existe porque la unicidad debe ser insensible a mayúsculas
// y acentos, y el COLLATE NOCASE de SQLite solo cubre ASCII.

export const MIN_JUGADORES = 2;
export const MAX_JUGADORES = 15;
export const MAX_FOTO_BYTES = 4 * 1024 * 1024;
export const MAX_BODY_BYTES = 30 * 1024 * 1024;

export interface JugadorValidado {
  nombre: string;
  apellidos: string;
  nombreCompletoNormalizado: string;
  telefono: string;
  telefonoNormalizado: string;
  email: string | null;
  emailNormalizado: string | null;
  redSocial: string | null;
}

export interface RegistroValidado {
  equipo: string;
  equipoNormalizado: string;
  jugadores: JugadorValidado[];
}

interface OpcionesValidacion {
  requireConsent?: boolean;
  ownerEmail?: string;
  requirePlayerEmail?: boolean;
}

export const normalizarTexto = (s: string): string =>
  s
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

export const normalizarTelefono = (s: string): string =>
  s.replace(/\D/g, "").replace(/^34(?=\d{9}$)/, "");

export const normalizarEmail = (s: string): string => s.trim().toLowerCase();

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;
const MOVIL_PATTERN = /^[67]\d{8}$/;
const NOMBRE_PATTERN = /^[\p{L}\p{M}'’. -]+$/u;
const HANDLE_PATTERN = /^@?[a-zA-Z0-9._]{2,30}$/;
const URL_SOCIAL_PATTERN = /^https:\/\/\S{5,110}$/;

const limpiar = (v: unknown): string =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";

/**
 * Valida el payload JSON del formulario. Devuelve el registro normalizado o
 * un mapa de errores por campo (claves "equipo", "consentimiento", "email" o
 * "jugadores.<índice>.<campo>") con mensajes listos para pintar en pantalla.
 */
export function validarRegistro(
  raw: unknown,
  opciones: OpcionesValidacion = {}
): { registro: RegistroValidado } | { campos: Record<string, string> } {
  const campos: Record<string, string> = {};
  const requireConsent = opciones.requireConsent !== false;
  const requirePlayerEmail = opciones.requirePlayerEmail !== false;
  const ownerEmailNormalizado = opciones.ownerEmail ? normalizarEmail(opciones.ownerEmail) : "";

  if (typeof raw !== "object" || raw === null) {
    return { campos: { equipo: "El formulario ha llegado vacío. Recarga la página e inténtalo de nuevo." } };
  }
  const body = raw as Record<string, unknown>;

  const equipo = limpiar(body.equipo);
  if (equipo.length < 2 || equipo.length > 60) {
    campos.equipo = "El nombre del equipo debe tener entre 2 y 60 caracteres.";
  }

  if (requireConsent && body.consentimiento !== true) {
    campos.consentimiento = "Necesitamos tu consentimiento para tratar los datos de la inscripción.";
  }


  const jugadoresRaw = Array.isArray(body.jugadores) ? body.jugadores : [];
  if (jugadoresRaw.length < MIN_JUGADORES) {
    campos.jugadores = `Un equipo necesita al menos ${MIN_JUGADORES} jugadores.`;
  } else if (jugadoresRaw.length > MAX_JUGADORES) {
    campos.jugadores = `Como máximo se admiten ${MAX_JUGADORES} personas por equipo.`;
  }

  const jugadores: JugadorValidado[] = [];
  let hayEmail = false;
  let hayOwnerEmail = false;

  jugadoresRaw.slice(0, MAX_JUGADORES).forEach((item, i) => {
    const j = (typeof item === "object" && item !== null ? item : {}) as Record<string, unknown>;
    const clave = (campo: string) => `jugadores.${i}.${campo}`;

    const nombre = limpiar(j.nombre);
    if (nombre.length < 2 || nombre.length > 60 || !NOMBRE_PATTERN.test(nombre)) {
      campos[clave("nombre")] = "Introduce el nombre (solo letras, entre 2 y 60 caracteres).";
    }

    const apellidos = limpiar(j.apellidos);
    if (apellidos.length < 2 || apellidos.length > 80 || !NOMBRE_PATTERN.test(apellidos)) {
      campos[clave("apellidos")] = "Introduce los apellidos (solo letras, entre 2 y 80 caracteres).";
    }

    const telefono = limpiar(j.telefono);
    const telefonoNormalizado = normalizarTelefono(telefono);
    if (!MOVIL_PATTERN.test(telefonoNormalizado)) {
      campos[clave("telefono")] = "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos).";
    }

    let email: string | null = null;
    let emailNormalizado: string | null = null;
    const emailRaw = limpiar(j.email);
    if (emailRaw) {
      if (!EMAIL_PATTERN.test(emailRaw) || emailRaw.length > 120) {
        campos[clave("email")] = "Ese correo no parece válido.";
      } else {
        email = emailRaw;
        emailNormalizado = normalizarEmail(emailRaw);
        hayEmail = true;
        if (emailNormalizado === ownerEmailNormalizado) {
          hayOwnerEmail = true;
        }
      }
    } else if (requirePlayerEmail) {
      campos[clave("email")] = "El correo de cada jugador es obligatorio.";
    }

    let redSocial: string | null = null;
    const redRaw = limpiar(j.redSocial);
    if (redRaw) {
      if (redRaw.length > 120 || !(HANDLE_PATTERN.test(redRaw) || URL_SOCIAL_PATTERN.test(redRaw))) {
        campos[clave("redSocial")] = "Usa un usuario tipo @nombre o un enlace https://.";
      } else {
        redSocial = redRaw;
      }
    }

    jugadores.push({
      nombre,
      apellidos,
      nombreCompletoNormalizado: normalizarTexto(`${nombre} ${apellidos}`),
      telefono,
      telefonoNormalizado,
      email,
      emailNormalizado,
      redSocial
    });
  });

  if (!hayEmail && !requirePlayerEmail && !campos.jugadores) {
    campos.email = "Indica al menos un correo en el equipo para poder enviaros la confirmación.";
  }

  // Duplicados dentro del propio envío.
  const vistos = { nombres: new Map<string, number>(), telefonos: new Map<string, number>(), emails: new Map<string, number>() };
  jugadores.forEach((j, i) => {
    const clave = (campo: string) => `jugadores.${i}.${campo}`;
    if (j.nombreCompletoNormalizado.length > 2) {
      if (vistos.nombres.has(j.nombreCompletoNormalizado)) {
        campos[clave("nombre")] = "Esta persona aparece dos veces en el formulario.";
      } else {
        vistos.nombres.set(j.nombreCompletoNormalizado, i);
      }
    }
    if (j.telefonoNormalizado) {
      if (vistos.telefonos.has(j.telefonoNormalizado)) {
        campos[clave("telefono")] = "Este móvil aparece dos veces en el formulario.";
      } else {
        vistos.telefonos.set(j.telefonoNormalizado, i);
      }
    }
    if (j.emailNormalizado) {
      if (vistos.emails.has(j.emailNormalizado)) {
        campos[clave("email")] = "Este correo aparece dos veces en el formulario.";
      } else {
        vistos.emails.set(j.emailNormalizado, i);
      }
    }
  });

  const hayErroresEmail = Object.keys(campos).some((key) => /^jugadores\.\d+\.email$/.test(key));
  if (ownerEmailNormalizado && !hayOwnerEmail && !hayErroresEmail && !campos.jugadores) {
    campos.email = "Uno de los correos de los jugadores debe ser el mismo con el que has iniciado sesión.";
  }

  if (Object.keys(campos).length > 0) {
    return { campos };
  }

  return {
    registro: {
      equipo,
      equipoNormalizado: normalizarTexto(equipo),
      jugadores
    }
  };
}

const TIPOS_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Valida una foto por tamaño, content-type declarado y magic bytes reales.
 * La extensión devuelta sale de los magic bytes, nunca del nombre de archivo.
 */
export function validarFoto(
  buffer: ArrayBuffer,
  contentType: string,
  size: number
): { ext: "jpg" | "png" | "webp" } | { error: string } {
  const error = { error: "Solo se admiten fotos JPG, PNG o WebP de hasta 4 MB." };
  if (size === 0 || size > MAX_FOTO_BYTES || !TIPOS_FOTO.has(contentType)) {
    return error;
  }
  const b = new Uint8Array(buffer.slice(0, 12));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return { ext: "jpg" };
  }
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    return { ext: "png" };
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { ext: "webp" };
  }
  return error;
}
