// Listado público de equipos: solo nombres y nº de jugadores.
// Render exclusivamente con createElement/textContent (nunca innerHTML).

(() => {
  const panel = document.querySelector("[data-teams]");
  if (!panel) return;

  const estado = panel.querySelector("[data-status]");
  const lista = panel.querySelector("[data-list]");
  const reintentar = panel.querySelector("[data-retry]");

  async function cargar() {
    estado.textContent = "Cargando equipos…";
    estado.hidden = false;
    lista.hidden = true;
    reintentar.hidden = true;

    try {
      const respuesta = await fetch("/api/equipos", { headers: { Accept: "application/json" } });
      if (!respuesta.ok) throw new Error(String(respuesta.status));
      const datos = await respuesta.json();
      const equipos = Array.isArray(datos.equipos) ? datos.equipos : [];

      if (equipos.length === 0) {
        estado.textContent = "Aún no hay equipos inscritos. Sé el primero.";
        return;
      }

      lista.textContent = "";
      equipos.forEach((equipo) => {
        const item = document.createElement("li");
        const nombre = document.createElement("span");
        nombre.className = "team-name";
        nombre.textContent = String(equipo.nombre || "");
        const cuenta = document.createElement("span");
        cuenta.className = "team-count";
        const n = Number(equipo.jugadores) || 0;
        cuenta.textContent = n === 1 ? "1 jugador" : `${n} jugadores`;
        item.append(nombre, cuenta);
        lista.appendChild(item);
      });
      estado.hidden = true;
      lista.hidden = false;
    } catch {
      estado.textContent = "No se ha podido cargar la lista de equipos.";
      reintentar.hidden = false;
    }
  }

  reintentar.addEventListener("click", cargar);
  cargar();
})();
