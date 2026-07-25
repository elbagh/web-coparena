// functions/_lib/nombres.ts
// Normaliza nombres/apellidos de jugadores a Proper Case. Cuando una palabra
// completa coincide (sin tildes, en minúsculas) con una entrada del
// diccionario de nombres/apellidos españoles y gallegos frecuentes, se usa
// su forma con tilde correcta. Fuera del diccionario solo se capitaliza: no
// se inventan tildes ni se cambian letras (una "ñ" que el usuario no
// escribió nunca se añade).

const DICCIONARIO: Record<string, string> = {
  // Nombres
  jose: "José",
  maria: "María",
  jesus: "Jesús",
  angel: "Ángel",
  angela: "Ángela",
  angelica: "Angélica",
  ruben: "Rubén",
  andres: "Andrés",
  ivan: "Iván",
  oscar: "Óscar",
  adrian: "Adrián",
  sebastian: "Sebastián",
  joaquin: "Joaquín",
  raul: "Raúl",
  victor: "Víctor",
  alvaro: "Álvaro",
  nicolas: "Nicolás",
  martin: "Martín",
  julian: "Julián",
  cristobal: "Cristóbal",
  cesar: "César",
  damian: "Damián",
  elias: "Elías",
  fabian: "Fabián",
  gines: "Ginés",
  hector: "Héctor",
  isaias: "Isaías",
  jeronimo: "Jerónimo",
  jonas: "Jonás",
  leon: "León",
  maximo: "Máximo",
  moises: "Moisés",
  nestor: "Néstor",
  ramon: "Ramón",
  saul: "Saúl",
  simon: "Simón",
  tomas: "Tomás",
  anibal: "Aníbal",
  adan: "Adán",
  agustin: "Agustín",
  benjamin: "Benjamín",
  fermin: "Fermín",
  german: "Germán",
  lazaro: "Lázaro",
  matias: "Matías",
  roman: "Román",
  salomon: "Salomón",
  teofilo: "Teófilo",
  valentin: "Valentín",
  xoan: "Xoán",
  monica: "Mónica",
  veronica: "Verónica",
  barbara: "Bárbara",
  africa: "África",
  agueda: "Águeda",
  belen: "Belén",
  eloisa: "Eloísa",
  erika: "Érika",
  fatima: "Fátima",
  ines: "Inés",
  lucia: "Lucía",
  rosalia: "Rosalía",
  sofia: "Sofía",
  aida: "Aída",
  asuncion: "Asunción",
  aurea: "Áurea",
  brigida: "Brígida",
  concepcion: "Concepción",
  rocio: "Rocío",
  // Apellidos
  garcia: "García",
  rodriguez: "Rodríguez",
  gonzalez: "González",
  fernandez: "Fernández",
  lopez: "López",
  martinez: "Martínez",
  sanchez: "Sánchez",
  perez: "Pérez",
  gomez: "Gómez",
  jimenez: "Jiménez",
  gimenez: "Giménez",
  hernandez: "Hernández",
  diaz: "Díaz",
  alvarez: "Álvarez",
  "nuñez": "Núñez",
  dominguez: "Domínguez",
  gutierrez: "Gutiérrez",
  vazquez: "Vázquez",
  ramirez: "Ramírez",
  suarez: "Suárez",
  "ibañez": "Ibáñez",
  cortes: "Cortés",
  marquez: "Márquez",
  velazquez: "Velázquez",
  saenz: "Sáenz",
  paez: "Páez",
  baez: "Báez",
  valdes: "Valdés",
  cordoba: "Córdoba",
  avila: "Ávila",
  galvan: "Galván",
  beltran: "Beltrán",
  "zuñiga": "Zúñiga",
  bermudez: "Bermúdez",
  galan: "Galán",
  rua: "Rúa",
  novoa: "Nóvoa",
  boveda: "Bóveda",
  dieguez: "Diéguez"
};

function quitarTildes(palabra: string): string {
  return palabra
    .replace(/[áàäâ]/g, "a")
    .replace(/[éèëê]/g, "e")
    .replace(/[íìïî]/g, "i")
    .replace(/[óòöô]/g, "o")
    .replace(/[úùüû]/g, "u");
}

function capitalizarToken(token: string): string {
  const minuscula = token.toLowerCase();
  const clave = quitarTildes(minuscula);
  const conocido = DICCIONARIO[clave];
  if (conocido) return conocido;
  return minuscula.replace(/(^|['])(\p{L})/gu, (_, previo, letra) => previo + letra.toUpperCase());
}

function capitalizarPalabra(palabra: string): string {
  return palabra
    .split("-")
    .map((token) => capitalizarToken(token))
    .join("-");
}

/**
 * Convierte un nombre o apellidos a Proper Case, restituyendo la tilde
 * correcta cuando la palabra coincide con el diccionario.
 */
export function capitalizarPropio(texto: string): string {
  return texto
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((palabra) => (palabra ? capitalizarPalabra(palabra) : palabra))
    .join(" ");
}

/** Devuelve solo el primer apellido (primer token) de una cadena de apellidos. */
export function primerApellido(apellidos: string): string {
  return apellidos.trim().split(/\s+/)[0] ?? "";
}
