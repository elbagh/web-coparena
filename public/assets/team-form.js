// Formulario de inscripción de equipos. Validación en cliente espejo de la
// del servidor (functions/_lib/validacion.ts): si cambian las reglas allí,
// cambiarlas también aquí. Los mensajes se pintan siempre con textContent.

(() => {
  const form = document.querySelector("[data-team-form]");
  if (!form) return;

  const plantilla = document.getElementById("player-template");
  const contenedor = form.querySelector("[data-players]");
  const botonAnadir = form.querySelector("[data-add-player]");
  const banner = form.querySelector("[data-banner]");
  const botonEnviar = form.querySelector("[data-submit]");
  const consentBox = form.querySelector("[data-consent]");
  const exito = document.querySelector("[data-success]");
  const exitoTexto = document.querySelector("[data-success-text]");

  const MIN_JUGADORES = 2;
  const MAX_JUGADORES = 15;
  const MAX_FOTO_BYTES = 4 * 1024 * 1024;
  const TIPOS_FOTO = ["image/jpeg", "image/png", "image/webp"];
  const EMAIL_RE = /^\S+@\S+\.\S+$/;
  const NOMBRE_RE = /^[\p{L}\p{M}'’. -]+$/u;
  const HANDLE_RE = /^@?[a-zA-Z0-9._]{2,30}$/;
  const URL_SOCIAL_RE = /^https:\/\/\S{5,110}$/;

  const limpiar = (v) => v.trim().replace(/\s+/g, " ");
  const movilNormalizado = (v) => v.replace(/\D/g, "").replace(/^34(?=\d{9}$)/, "");
  const emailNormalizado = (v) => limpiar(v).toLowerCase();

  const cartas = () => Array.from(contenedor.querySelectorAll("[data-player]"));
  const usuarioActual = () => window.CopaAuth?.state?.user || null;

  // ------------------------------ errores en pantalla ------------------------------

  const errorDe = (campoWrap) => campoWrap.querySelector(".field-error");

  function pintarError(campoWrap, mensaje) {
    const p = errorDe(campoWrap);
    const input = campoWrap.querySelector("input");
    if (!p || !input) return;
    if (mensaje) {
      p.textContent = mensaje;
      p.hidden = false;
      input.setAttribute("aria-invalid", "true");
    } else {
      p.textContent = "";
      p.hidden = true;
      input.removeAttribute("aria-invalid");
    }
  }

  function mostrarBanner(mensaje) {
    banner.textContent = mensaje;
    banner.hidden = !mensaje;
    if (mensaje) banner.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function limpiarErrores() {
    mostrarBanner("");
    form.querySelectorAll(".field").forEach((f) => pintarError(f, ""));
    pintarError(consentBox, "");
  }

  // ------------------------------ filas de jugador ------------------------------

  function crearJugador() {
    const carta = plantilla.content.firstElementChild.cloneNode(true);
    carta.querySelector("[data-remove]").addEventListener("click", () => {
      carta.remove();
      reindexar();
    });
    carta.querySelectorAll("input").forEach((input) => {
      input.addEventListener("blur", () => validarCampo(input));
      if (input.dataset.field === "foto") {
        input.addEventListener("change", () => validarCampo(input));
      }
    });
    contenedor.appendChild(carta);
    reindexar();
    return carta;
  }

  function rellenarEmailGoogle() {
    const userEmail = usuarioActual()?.email;
    if (!userEmail) return;
    const primerEmail = cartas()[0]?.querySelector('[data-field="email"]');
    if (primerEmail && !limpiar(primerEmail.value)) {
      primerEmail.value = userEmail;
      validarCampo(primerEmail);
    }
  }

  function reindexar() {
    const lista = cartas();
    lista.forEach((carta, i) => {
      carta.querySelector("[data-dorsal]").textContent = String(i + 1);
      carta.querySelector("[data-role]").textContent = i < MIN_JUGADORES ? "Titular" : "Suplente";
      carta.classList.toggle("is-suplente", i >= MIN_JUGADORES);
      carta.querySelector("[data-remove]").hidden = i < MIN_JUGADORES;
      carta.querySelectorAll("[data-field]").forEach((input) => {
        const campo = input.dataset.field;
        input.id = `j${i}-${campo}`;
        const etiqueta = carta.querySelector(`[data-label="${campo}"]`);
        if (etiqueta) etiqueta.setAttribute("for", input.id);
        const p = errorDe(input.closest(".field"));
        if (p) {
          p.id = `j${i}-${campo}-error`;
          input.setAttribute("aria-describedby", p.id);
        }
      });
    });
    botonAnadir.disabled = lista.length >= MAX_JUGADORES;
    botonAnadir.textContent =
      lista.length >= MAX_JUGADORES
        ? `Máximo ${MAX_JUGADORES} personas por equipo`
        : "+ Añadir suplente";
  }

  // ------------------------------ validación ------------------------------

  function mensajeDe(input) {
    const campo = input.dataset.field;
    const v = limpiar(input.value || "");
    switch (campo) {
      case "equipo":
        return v.length < 2 || v.length > 60
          ? "El nombre del equipo debe tener entre 2 y 60 caracteres."
          : "";
      case "nombre":
        return v.length < 2 || v.length > 60 || !NOMBRE_RE.test(v)
          ? "Introduce el nombre (solo letras, entre 2 y 60 caracteres)."
          : "";
      case "apellidos":
        return v.length < 2 || v.length > 80 || !NOMBRE_RE.test(v)
          ? "Introduce los apellidos (solo letras, entre 2 y 80 caracteres)."
          : "";
      case "telefono":
        return !/^[67]\d{8}$/.test(movilNormalizado(v))
          ? "Introduce un móvil válido (empieza por 6 o 7 y tiene 9 dígitos)."
          : "";
      case "email":
        if (!v) return "El correo de cada jugador es obligatorio.";
        return !EMAIL_RE.test(v) || v.length > 120 ? "Ese correo no parece válido." : "";
      case "redSocial":
        return v && (v.length > 120 || !(HANDLE_RE.test(v) || URL_SOCIAL_RE.test(v)))
          ? "Usa un usuario tipo @nombre o un enlace https://."
          : "";
      case "foto": {
        const archivo = input.files && input.files[0];
        if (!archivo) return "";
        return archivo.size > MAX_FOTO_BYTES || !TIPOS_FOTO.includes(archivo.type)
          ? "Solo se admiten fotos JPG, PNG o WebP de hasta 4 MB."
          : "";
      }
      default:
        return "";
    }
  }

  function validarCampo(input) {
    const mensaje = mensajeDe(input);
    pintarError(input.closest(".field"), mensaje);
    return !mensaje;
  }

  // ------------------------------ envío ------------------------------

  function datosJugador(carta) {
    const valor = (campo) => {
      const input = carta.querySelector(`[data-field="${campo}"]`);
      return limpiar(input ? input.value : "");
    };
    const jugador = {
      nombre: valor("nombre"),
      apellidos: valor("apellidos"),
      telefono: valor("telefono")
    };
    const email = valor("email");
    if (email) jugador.email = email;
    const red = valor("redSocial");
    if (red) jugador.redSocial = red;
    return jugador;
  }

  function pintarErroresServidor(campos) {
    const lista = cartas();
    const sueltos = [];
    Object.entries(campos).forEach(([clave, mensaje]) => {
      if (clave === "equipo") {
        pintarError(form.querySelector('[data-field="equipo"]').closest(".field"), mensaje);
        return;
      }
      if (clave === "consentimiento") {
        pintarError(consentBox, mensaje);
        return;
      }
      const partes = clave.match(/^jugadores\.(\d+)\.(\w+)$/);
      if (partes && lista[Number(partes[1])]) {
        const input = lista[Number(partes[1])].querySelector(`[data-field="${partes[2]}"]`);
        if (input) {
          pintarError(input.closest(".field"), mensaje);
          return;
        }
      }
      sueltos.push(mensaje);
    });
    return sueltos;
  }

  function enfocarPrimerError() {
    const invalido = form.querySelector('[aria-invalid="true"]');
    if (invalido) {
      invalido.focus({ preventScroll: false });
      invalido.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  form.addEventListener("submit", async (evento) => {
    evento.preventDefault();
    limpiarErrores();
    try {
      rellenarEmailGoogle();
    } catch (err) {
      console.error("Error preparando el formulario de equipo:", err);
      mostrarBanner("No hemos podido preparar el formulario. Recarga la pagina e intentalo de nuevo.");
      return;
    }

    let valido = true;
    form.querySelectorAll("[data-field]").forEach((input) => {
      if (input.dataset.field === "consentimiento") return;
      if (!validarCampo(input)) valido = false;
    });

    const consentimiento = consentBox.querySelector('[data-field="consentimiento"]').checked;
    if (!consentimiento) {
      pintarError(consentBox, "Necesitamos tu consentimiento para tratar los datos de la inscripción.");
      valido = false;
    }

    const lista = cartas();
    const jugadores = lista.map(datosJugador);
    const userEmail = usuarioActual()?.email;
    if (!userEmail) {
      mostrarBanner("Inicia sesión para que el equipo quede asociado a tu cuenta.");
      valido = false;
    } else if (!jugadores.some((j) => emailNormalizado(j.email || "") === emailNormalizado(userEmail))) {
      const primerEmail = lista[0]?.querySelector('[data-field="email"]');
      if (primerEmail) {
        pintarError(
          primerEmail.closest(".field"),
          "El correo de tu cuenta debe aparecer en al menos un jugador."
        );
      }
      mostrarBanner(`Uno de los jugadores debe usar el correo con el que has iniciado sesión: ${userEmail}.`);
      valido = false;
    }

    if (!valido) {
      if (banner.hidden) mostrarBanner("Revisa los campos marcados.");
      enfocarPrimerError();
      return;
    }

    const payload = {
      equipo: limpiar(form.querySelector('[data-field="equipo"]').value),
      consentimiento: true,
      jugadores
    };

    const datos = new FormData();
    datos.append("payload", JSON.stringify(payload));
    lista.forEach((carta, i) => {
      const foto = carta.querySelector('[data-field="foto"]');
      if (foto && foto.files && foto.files[0]) {
        datos.append(`foto_${i}`, foto.files[0]);
      }
    });

    botonEnviar.disabled = true;
    botonEnviar.setAttribute("aria-busy", "true");
    const textoOriginal = botonEnviar.textContent;
    botonEnviar.textContent = "Enviando…";

    try {
      const respuesta = await fetch("/api/equipos", { method: "POST", body: datos });
      let cuerpo = {};
      try {
        cuerpo = await respuesta.json();
      } catch {
        cuerpo = {};
      }

      if (respuesta.ok && cuerpo.ok) {
        await window.CopaAuth?.refresh?.();
        form.hidden = true;
        exitoTexto.textContent = cuerpo.emailEnviado
          ? `«${payload.equipo}» ya está en La Copa Arena. Os hemos enviado la confirmación a los correos indicados.`
          : `«${payload.equipo}» ya está en La Copa Arena. ${cuerpo.aviso || ""}`.trim();
        exito.hidden = false;
        exito.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }

      const sueltos = cuerpo.campos ? pintarErroresServidor(cuerpo.campos) : [];
      const mensaje = [cuerpo.error || "No se ha podido completar la inscripción. Inténtalo de nuevo.", ...sueltos].join(" ");
      mostrarBanner(mensaje);
      enfocarPrimerError();
    } catch {
      mostrarBanner("No hay conexión. Comprueba la red e inténtalo de nuevo.");
    } finally {
      botonEnviar.disabled = false;
      botonEnviar.removeAttribute("aria-busy");
      botonEnviar.textContent = textoOriginal;
    }
  });

  // ------------------------------ arranque ------------------------------

  form.querySelector('[data-field="equipo"]').addEventListener("blur", (e) => validarCampo(e.target));
  botonAnadir.addEventListener("click", () => {
    const carta = crearJugador();
    const primero = carta.querySelector("input");
    if (primero) primero.focus();
  });

  crearJugador();
  crearJugador();
  rellenarEmailGoogle();

  window.addEventListener("copa:auth", (event) => {
    const detail = event.detail || {};
    if (!detail.loading && detail.user && !detail.team) {
      rellenarEmailGoogle();
    }
  });
})();
