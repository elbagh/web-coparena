import { describe, expect, it } from "vitest";
import {
  clasificarWorktrees,
  colisionesDeMigracion,
  duplicadosDeMigracion,
  mismaRuta,
  normalizarRama,
  puertosDeSlot,
  ramasBorrables,
  retirables,
  siguienteNumeroMigracion,
  slotLibre
} from "../../scripts/_lib/ramas.mjs";

describe("normalizarRama", () => {
  it("pone feature/ cuando solo se da el nombre corto", () => {
    expect(normalizarRama("mi-cosa")).toMatchObject({
      rama: "feature/mi-cosa",
      nombreCorto: "mi-cosa",
      base: "origin/development"
    });
  });

  it("respeta el prefijo dado y acepta versiones en release", () => {
    expect(normalizarRama("bugfix/album-vacio").rama).toBe("bugfix/album-vacio");
    expect(normalizarRama("release/1.4.0").nombreCorto).toBe("1.4.0");
  });

  // Un hotfix parchea lo que está en producción: nacer de development le
  // colaría al parche todo lo que aún no se ha promovido.
  it("un hotfix nace de main y todo lo demás de development", () => {
    expect(normalizarRama("hotfix/login-roto").base).toBe("origin/main");
    expect(normalizarRama("feature/x").base).toBe("origin/development");
    expect(normalizarRama("release/1.0.0").base).toBe("origin/development");
  });

  it("rechaza prefijos inventados, nombres imposibles y barras de más", () => {
    expect(() => normalizarRama("feat/x")).toThrow(/Prefijo/);
    expect(() => normalizarRama("feature/Mi Cosa")).toThrow(/nombre corto/);
    expect(() => normalizarRama("feature/sub/cosa")).toThrow(/barras/);
    expect(() => normalizarRama("")).toThrow(/Falta el nombre/);
  });
});

describe("numeración de migraciones", () => {
  const REALES = [
    "0021_partidos_origen_marcador.sql",
    "0022_clasificacion_repesca.sql",
    "0022_fuera_is_admin.sql",
    "0023_cromo_jugador.sql"
  ];

  // El accidente que de verdad pasó dos veces en este repo (0003 y 0022): dos
  // sesiones cogiendo «el siguiente número» a la vez.
  it("encuentra los números repetidos que ya hay en el repo", () => {
    expect(duplicadosDeMigracion(REALES)).toEqual([
      { numero: "0022", ficheros: ["0022_clasificacion_repesca.sql", "0022_fuera_is_admin.sql"] }
    ]);
  });

  it("no ve duplicados donde no los hay", () => {
    expect(duplicadosDeMigracion(["0001_init.sql", "0002_equipos.sql"])).toEqual([]);
  });

  it("el siguiente número sale del mayor, aunque haya repetidos", () => {
    expect(siguienteNumeroMigracion(REALES)).toBe("0024");
    expect(siguienteNumeroMigracion([])).toBe("0001");
    expect(siguienteNumeroMigracion(["0009_estadisticas.sql"])).toBe("0010");
  });

  it("ignora lo que no lleva número delante", () => {
    expect(siguienteNumeroMigracion(["README.md", "0004_camisetas.sql"])).toBe("0005");
  });

  it("acepta rutas completas, no solo nombres de fichero", () => {
    expect(siguienteNumeroMigracion(["db/migrations/0012_partido_id.sql"])).toBe("0013");
  });
});

describe("colisionesDeMigracion", () => {
  it("canta el mismo número con ficheros distintos", () => {
    const choques = colisionesDeMigracion(
      ["0025_lo_mio.sql", "0026_tambien_mio.sql"],
      ["0025_lo_suyo.sql"]
    );
    expect(choques).toEqual([
      { numero: "0025", mias: ["0025_lo_mio.sql"], otras: ["0025_lo_suyo.sql"] }
    ]);
  });

  // Las migraciones que las dos ramas comparten son el caso normal: mismo
  // número y mismo nombre porque son la misma migración.
  it("no canta las migraciones que comparten las dos ramas", () => {
    const comunes = ["0001_init.sql", "0002_equipos.sql"];
    expect(colisionesDeMigracion([...comunes, "0003_nueva.sql"], comunes)).toEqual([]);
  });

  it("no canta nada cuando mi número es libre", () => {
    expect(colisionesDeMigracion(["0026_mia.sql"], ["0025_suya.sql"])).toEqual([]);
  });
});

describe("puertos por slot", () => {
  // El slot 0 es el checkout principal porque es el par que fija
  // .claude/launch.json, que es el que lee el pane de preview.
  it("el slot 0 es el par de launch.json y cada slot salta de diez en diez", () => {
    expect(puertosDeSlot(0)).toEqual({ astro: 4321, worker: 8788 });
    expect(puertosDeSlot(1)).toEqual({ astro: 4331, worker: 8798 });
    expect(puertosDeSlot(3)).toEqual({ astro: 4351, worker: 8818 });
  });

  it("reparte el primer slot libre y nunca el 0", () => {
    expect(slotLibre([])).toBe(1);
    expect(slotLibre([1, 3])).toBe(2);
    expect(slotLibre([2, 1])).toBe(3);
  });

  it("devuelve null cuando están todos cogidos, en vez de repartir un choque", () => {
    expect(slotLibre([1, 2, 3, 4, 5, 6, 7, 8])).toBeNull();
  });
});

describe("clasificarWorktrees", () => {
  it("compara rutas de Windows con las dos barras y sin distinguir mayúsculas", () => {
    expect(mismaRuta("D:/repo/.worktrees/x", "D:\\repo\\.worktrees\\x")).toBe(true);
    expect(mismaRuta("D:/Repo/.worktrees/X/", "d:/repo/.worktrees/x")).toBe(true);
    expect(mismaRuta("D:/repo/.worktrees/x", "D:/repo/.worktrees/y")).toBe(false);
  });

  // El caso de `.worktrees/publica`: quedó el directorio con dist/ y
  // node_modules/ pero sin el fichero .git que lo apunta, así que git subía por
  // el árbol y operaba sobre el checkout principal.
  it("separa los worktrees de verdad de los directorios que dejó un rm -rf", () => {
    const { worktrees, huerfanos } = clasificarWorktrees({
      registrados: ["D:/repo/.worktrees/viva"],
      enDisco: ["D:/repo/.worktrees/viva", "D:/repo/.worktrees/publica"]
    });
    expect(worktrees).toEqual(["D:/repo/.worktrees/viva"]);
    expect(huerfanos).toEqual(["D:/repo/.worktrees/publica"]);
  });
});

describe("retirables", () => {
  const wt = (extra: Record<string, unknown>) => ({
    ruta: "D:/repo/.worktrees/x",
    rama: "feature/x",
    esPrincipal: false,
    esActual: false,
    sucio: false,
    bloqueado: false,
    integrada: true,
    enSincronia: false,
    ...extra
  });

  const motivo = (entrada: Record<string, unknown>) => retirables([wt(entrada)]).retenidas[0]?.motivo;

  it("retira un worktree limpio cuya rama ya está en development", () => {
    const { retirables: fuera, retenidas } = retirables([wt({})]);
    expect(fuera).toHaveLength(1);
    expect(retenidas).toHaveLength(0);
  });

  it("no toca el checkout principal ni el worktree desde el que se trabaja", () => {
    expect(motivo({ esPrincipal: true })).toMatch(/principal/);
    expect(motivo({ esActual: true })).toMatch(/trabajando/);
  });

  it("no toca lo que tiene cambios sin commitear, aunque la rama esté integrada", () => {
    expect(motivo({ sucio: true })).toMatch(/sin commitear/);
  });

  it("no toca una rama que no está integrada: puede ser trabajo vivo de otra sesión", () => {
    expect(motivo({ integrada: false })).toMatch(/no está integrada/);
  });

  it("respeta un worktree bloqueado a mano", () => {
    expect(motivo({ bloqueado: true })).toMatch(/bloqueado/);
  });

  // El caso de `.worktrees/promote-main`: `main` no está «integrado» en
  // development y sin embargo el worktree no tiene nada que perder, porque
  // coincide con origin/main. Y mientras existe, bloquea la promoción.
  it("retira un promote-main olvidado, que está en sincronía sin estar integrado", () => {
    const promote = wt({ rama: "main", integrada: false, enSincronia: true });
    expect(retirables([promote]).retirables).toHaveLength(1);
  });
});

describe("ramasBorrables", () => {
  const ramas = [
    { nombre: "development", integrada: true },
    { nombre: "main", integrada: false },
    { nombre: "feature/vieja", integrada: true },
    { nombre: "feature/abierta", integrada: true },
    { nombre: "feature/en-marcha", integrada: false }
  ];

  it("solo las integradas, sin worktree, y nunca main ni development", () => {
    expect(ramasBorrables({ ramas, conWorktree: ["feature/abierta"], actual: null })).toEqual([
      "feature/vieja"
    ]);
  });

  it("nunca la rama en la que estás", () => {
    expect(ramasBorrables({ ramas, conWorktree: [], actual: "feature/vieja" })).toEqual([
      "feature/abierta"
    ]);
  });
});
