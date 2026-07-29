import { describe, expect, it } from "vitest";
import {
  MAX_FOTO_BYTES,
  MAX_JUGADORES,
  MENSAJE_CAPITAN_CONTACTO,
  MIN_JUGADORES,
  limpiar,
  normalizarEmail,
  normalizarTelefono,
  normalizarTexto,
  validarFoto,
  validarRegistro
} from "../../functions/_lib/validacion";

const jugador = (extra: Record<string, unknown> = {}) => ({
  nombre: "Ana",
  apellidos: "Pérez",
  telefono: "666111222",
  email: "ana@example.com",
  ...extra
});

const registroValido = (extra: Record<string, unknown> = {}) => ({
  equipo: "Los Delfines",
  consentimiento: true,
  capitan: 0,
  jugadores: [jugador(), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "luis@example.com" })],
  ...extra
});

/** Estrecha el resultado a los errores, fallando con un mensaje útil si validó. */
function campos(resultado: ReturnType<typeof validarRegistro>): Record<string, string> {
  if ("registro" in resultado) {
    throw new Error("Se esperaban errores de validación y el registro pasó.");
  }
  return resultado.campos;
}

describe("normalizadores", () => {
  it("normalizarTexto quita acentos, baja a minúsculas y colapsa espacios", () => {
    expect(normalizarTexto("  Los   Delfínes DEL Pozo ")).toBe("los delfines del pozo");
  });

  it("normalizarTexto trata como iguales dos nombres que solo difieren en tildes", () => {
    expect(normalizarTexto("José Ángel")).toBe(normalizarTexto("jose angel"));
  });

  it("normalizarTelefono deja solo dígitos y recorta el prefijo 34", () => {
    expect(normalizarTelefono("+34 666 111 222")).toBe("666111222");
    expect(normalizarTelefono("666-111-222")).toBe("666111222");
    expect(normalizarTelefono("(666) 111 222")).toBe("666111222");
  });

  it("normalizarTelefono no recorta el 34 si no quedan nueve dígitos detrás", () => {
    expect(normalizarTelefono("34666111")).toBe("34666111");
  });

  // Comportamiento actual, no necesariamente el deseado: el recorte del prefijo
  // está anclado al principio, así que un "0034…" sobrevive entero y luego cae
  // en MOVIL_PATTERN. Si algún día se admite esa forma, este test debe cambiar.
  it("normalizarTelefono no reconoce el prefijo internacional escrito como 0034", () => {
    expect(normalizarTelefono("0034666111222")).toBe("0034666111222");
  });

  it("normalizarEmail recorta y baja a minúsculas", () => {
    expect(normalizarEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });

  it("limpiar devuelve cadena vacía para lo que no es texto", () => {
    expect(limpiar("  a   b ")).toBe("a b");
    expect(limpiar(null)).toBe("");
    expect(limpiar(42)).toBe("");
  });
});

describe("validarRegistro: camino feliz", () => {
  it("devuelve el registro con los campos normalizados", () => {
    const resultado = validarRegistro(registroValido());
    expect("registro" in resultado).toBe(true);
    if (!("registro" in resultado)) return;

    expect(resultado.registro.equipo).toBe("Los Delfines");
    expect(resultado.registro.equipoNormalizado).toBe("los delfines");
    expect(resultado.registro.jugadores).toHaveLength(2);
    expect(resultado.registro.jugadores[0]!.nombreCompletoNormalizado).toBe("ana perez");
    expect(resultado.registro.jugadores[0]!.telefonoNormalizado).toBe("666111222");
    expect(resultado.registro.jugadores[0]!.emailNormalizado).toBe("ana@example.com");
  });

  it("capitaliza nombre y apellidos con el diccionario", () => {
    const resultado = validarRegistro(
      registroValido({
        jugadores: [
          jugador({ nombre: "jose", apellidos: "garcia" }),
          jugador({ nombre: "luis", apellidos: "gomez", telefono: "677333444", email: "luis@example.com" })
        ]
      })
    );
    if (!("registro" in resultado)) throw new Error("debería validar");
    expect(resultado.registro.jugadores[0]!.nombre).toBe("José");
    expect(resultado.registro.jugadores[0]!.apellidos).toBe("García");
  });
});

describe("validarRegistro: equipo y consentimiento", () => {
  it("rechaza un payload que no es objeto", () => {
    expect(campos(validarRegistro(null)).equipo).toBeTruthy();
    expect(campos(validarRegistro("hola")).equipo).toBeTruthy();
  });

  it("rechaza nombres de equipo de menos de 2 o más de 60 caracteres", () => {
    expect(campos(validarRegistro(registroValido({ equipo: "X" }))).equipo).toBeTruthy();
    expect(campos(validarRegistro(registroValido({ equipo: "X".repeat(61) }))).equipo).toBeTruthy();
  });

  it("exige consentimiento por defecto", () => {
    expect(campos(validarRegistro(registroValido({ consentimiento: false }))).consentimiento).toBeTruthy();
  });

  it("omite el consentimiento cuando requireConsent es false", () => {
    const resultado = validarRegistro(registroValido({ consentimiento: false }), { requireConsent: false });
    expect("registro" in resultado).toBe(true);
  });
});

describe("validarRegistro: tamaño de la plantilla", () => {
  it(`exige al menos ${MIN_JUGADORES} jugadores`, () => {
    expect(campos(validarRegistro(registroValido({ jugadores: [jugador()] }))).jugadores).toBeTruthy();
    expect(campos(validarRegistro(registroValido({ jugadores: [] }))).jugadores).toBeTruthy();
  });

  it(`rechaza más de ${MAX_JUGADORES} personas`, () => {
    const muchos = Array.from({ length: MAX_JUGADORES + 1 }, (_, i) =>
      jugador({ nombre: `Jugador${i}`, apellidos: `Apellido${i}`, telefono: `6${String(10000000 + i)}`, email: `j${i}@example.com` })
    );
    expect(campos(validarRegistro(registroValido({ jugadores: muchos }))).jugadores).toBeTruthy();
  });
});

describe("validarRegistro: campos de jugador", () => {
  it("señala el nombre inválido con la clave del índice", () => {
    const errores = campos(validarRegistro(registroValido({ jugadores: [jugador({ nombre: "A" }), jugador({ telefono: "677333444", email: "b@example.com", nombre: "Luis", apellidos: "Gómez" })] })));
    expect(errores["jugadores.0.nombre"]).toBeTruthy();
  });

  it("rechaza nombres con dígitos pero acepta acentos, guiones y apóstrofos", () => {
    const conDigitos = campos(validarRegistro(registroValido({ jugadores: [jugador({ nombre: "Ana2" }), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })] })));
    expect(conDigitos["jugadores.0.nombre"]).toBeTruthy();

    const conSignos = validarRegistro(
      registroValido({
        jugadores: [
          jugador({ nombre: "Ana-María", apellidos: "O'Neill Ávila" }),
          jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })
        ]
      })
    );
    expect("registro" in conSignos).toBe(true);
  });

  it("solo admite móviles que empiezan por 6 o 7 y tienen nueve dígitos", () => {
    const fijo = campos(validarRegistro(registroValido({ jugadores: [jugador({ telefono: "981123456" }), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })] })));
    expect(fijo["jugadores.0.telefono"]).toBeTruthy();

    const corto = campos(validarRegistro(registroValido({ jugadores: [jugador({ telefono: "66611122" }), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })] })));
    expect(corto["jugadores.0.telefono"]).toBeTruthy();
  });

  it("acepta el móvil escrito con prefijo y espacios", () => {
    const resultado = validarRegistro(
      registroValido({
        jugadores: [
          jugador({ telefono: "+34 666 111 222" }),
          jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })
        ]
      })
    );
    expect("registro" in resultado).toBe(true);
  });

  it("rechaza correos con formato inválido", () => {
    const errores = campos(validarRegistro(registroValido({ jugadores: [jugador({ email: "ana@example" }), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })] })));
    expect(errores["jugadores.0.email"]).toBeTruthy();
  });

  it("acepta red social como handle o como URL https, y rechaza lo demás", () => {
    const conHandle = validarRegistro(registroValido({ jugadores: [jugador({ redSocial: "@ana.volley" }), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com", redSocial: "https://instagram.com/luis" })] }));
    expect("registro" in conHandle).toBe(true);

    const mala = campos(validarRegistro(registroValido({ jugadores: [jugador({ redSocial: "instagram.com/ana" }), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })] })));
    expect(mala["jugadores.0.redSocial"]).toBeTruthy();
  });

  it("recoge el id del jugador solo cuando es un entero positivo", () => {
    const resultado = validarRegistro(
      registroValido({
        jugadores: [
          jugador({ id: 7 }),
          jugador({ id: "12", nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })
        ]
      })
    );
    if (!("registro" in resultado)) throw new Error("debería validar");
    expect(resultado.registro.jugadores[0]!.id).toBe(7);
    expect(resultado.registro.jugadores[1]!.id).toBe(12);
  });

  it("ignora ids que no son enteros positivos", () => {
    for (const id of [0, -3, 1.5, "abc", null, {}]) {
      const resultado = validarRegistro(
        registroValido({
          jugadores: [jugador({ id }), jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "b@example.com" })]
        })
      );
      if (!("registro" in resultado)) throw new Error("debería validar");
      expect(resultado.registro.jugadores[0]!.id, `id ${JSON.stringify(id)}`).toBeUndefined();
    }
  });
});

describe("validarRegistro: duplicados dentro del envío", () => {
  it("detecta la misma persona repetida aunque cambien tildes y mayúsculas", () => {
    const errores = campos(
      validarRegistro(
        registroValido({
          jugadores: [
            jugador({ nombre: "Ana", apellidos: "Pérez" }),
            jugador({ nombre: "ANA", apellidos: "perez", telefono: "677333444", email: "b@example.com" })
          ]
        })
      )
    );
    expect(errores["jugadores.1.nombre"]).toContain("dos veces");
  });

  it("detecta el mismo móvil repetido aunque se escriba distinto", () => {
    const errores = campos(
      validarRegistro(
        registroValido({
          jugadores: [
            jugador({ telefono: "666111222" }),
            jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "+34 666 111 222", email: "b@example.com" })
          ]
        })
      )
    );
    expect(errores["jugadores.1.telefono"]).toContain("dos veces");
  });

  it("detecta el mismo correo repetido con distinta capitalización", () => {
    const errores = campos(
      validarRegistro(
        registroValido({
          jugadores: [
            jugador({ email: "ana@example.com" }),
            jugador({ nombre: "Luis", apellidos: "Gómez", telefono: "677333444", email: "ANA@Example.com" })
          ]
        })
      )
    );
    expect(errores["jugadores.1.email"]).toContain("dos veces");
  });
});

describe("capitán", () => {
  it("exige que el payload diga quién es el capitán", () => {
    const errores = campos(validarRegistro({ ...registroValido(), capitan: undefined }));
    expect(errores.capitan).toBe("Indica quién es el capitán del equipo.");
  });

  it("rechaza un capitán fuera de la plantilla", () => {
    const errores = campos(validarRegistro({ ...registroValido(), capitan: 7 }));
    expect(errores.capitan).toBe("Indica quién es el capitán del equipo.");
  });

  it("exige móvil y correo al capitán", () => {
    const base = registroValido();
    base.jugadores[0].telefono = "";
    base.jugadores[0].email = "";
    const errores = campos(validarRegistro({ ...base, capitan: 0 }));
    expect(errores["jugadores.0.telefono"]).toBe(MENSAJE_CAPITAN_CONTACTO);
    expect(errores["jugadores.0.email"]).toBe(MENSAJE_CAPITAN_CONTACTO);
  });

  it("deja sin móvil ni correo a quien no es capitán", () => {
    const base = registroValido();
    base.jugadores[1].telefono = "";
    base.jugadores[1].email = "";
    const resultado = validarRegistro({ ...base, capitan: 0 });
    expect("registro" in resultado).toBe(true);
    if ("registro" in resultado) {
      expect(resultado.registro.jugadores[1]!.telefono).toBe("");
      expect(resultado.registro.jugadores[1]!.telefonoNormalizado).toBe("");
      expect(resultado.registro.jugadores[1]!.email).toBeNull();
      expect(resultado.registro.capitan).toBe(0);
    }
  });

  it("valida el formato del móvil cuando sí se rellena", () => {
    const base = registroValido();
    base.jugadores[1].telefono = "123";
    const errores = campos(validarRegistro({ ...base, capitan: 0 }));
    expect(errores["jugadores.1.telefono"]).toBe(
      "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
    );
  });

  it("no toma por duplicados a dos jugadores sin móvil", () => {
    const base = registroValido();
    base.jugadores[1].telefono = "";
    base.jugadores.push({ nombre: "Tres", apellidos: "Tercero", telefono: "", email: "" });
    // Ninguno de los dos es capitán, así que el registro valida entero: no hay
    // "campos" que extraer. Se comprueba directamente sobre el resultado en vez
    // de con el helper campos() (que asume que debe haber errores) para que
    // esta prueba siga detectando una regresión del hueco vacío tratado como
    // duplicado sin depender de que exista algún otro error en el payload.
    const resultado = validarRegistro({ ...base, capitan: 0 });
    const errores = "campos" in resultado ? resultado.campos : {};
    expect(errores["jugadores.1.telefono"]).toBeUndefined();
    expect(errores["jugadores.2.telefono"]).toBeUndefined();
  });

  it("exige que el correo del capitán sea el de la sesión cuando se pide", () => {
    const errores = campos(
      validarRegistro({ ...registroValido(), capitan: 0 }, { emailCapitanObligatorio: "otra@example.com" })
    );
    expect(errores["jugadores.0.email"]).toBe(
      "El capitán debe usar el correo con el que has iniciado sesión."
    );
  });
});

describe("validarFoto", () => {
  const conBytes = (bytes: number[], relleno = 0) => {
    const buffer = new Uint8Array([...bytes, ...new Array(relleno).fill(0)]);
    return buffer.buffer;
  };
  const JPG = [0xff, 0xd8, 0xff];
  const PNG = [0x89, 0x50, 0x4e, 0x47];
  const WEBP = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];

  it("reconoce JPG, PNG y WebP por sus magic bytes", () => {
    expect(validarFoto(conBytes(JPG, 9), "image/jpeg", 12)).toEqual({ ext: "jpg" });
    expect(validarFoto(conBytes(PNG, 8), "image/png", 12)).toEqual({ ext: "png" });
    expect(validarFoto(conBytes(WEBP), "image/webp", 12)).toEqual({ ext: "webp" });
  });

  it("saca la extensión de los bytes, no del content-type declarado", () => {
    expect(validarFoto(conBytes(JPG, 9), "image/png", 12)).toEqual({ ext: "jpg" });
  });

  it("rechaza bytes que no son de ninguna imagen admitida aunque el tipo sea válido", () => {
    expect(validarFoto(conBytes([0x47, 0x49, 0x46, 0x38], 8), "image/png", 12)).toHaveProperty("error");
  });

  it("rechaza tamaño cero y tamaño por encima del límite", () => {
    expect(validarFoto(conBytes(JPG, 9), "image/jpeg", 0)).toHaveProperty("error");
    expect(validarFoto(conBytes(JPG, 9), "image/jpeg", MAX_FOTO_BYTES + 1)).toHaveProperty("error");
  });

  it("rechaza tipos no admitidos", () => {
    expect(validarFoto(conBytes(JPG, 9), "image/gif", 12)).toHaveProperty("error");
    expect(validarFoto(conBytes(JPG, 9), "application/pdf", 12)).toHaveProperty("error");
  });
});
