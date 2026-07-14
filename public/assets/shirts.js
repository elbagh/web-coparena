(() => {
  const roots = Array.from(document.querySelectorAll("[data-shirts]"));
  if (roots.length === 0) return;

  const limpiar = (value) => String(value || "").trim().replace(/\s+/g, " ");
  const TALLAS = new Set(["XS", "S", "M", "L", "XL", "XXL"]);

  let reservas = [];
  let loaded = false;

  function field(form, name) {
    return form?.querySelector(`[data-shirt-field="${name}"]`);
  }

  function errorNode(form, name) {
    return form?.querySelector(`[data-shirt-error="${name}"]`);
  }

  function setStatus(root, message) {
    const status = root.querySelector("[data-shirts-status]");
    if (status) {
      status.textContent = message || "";
      status.hidden = !message;
    }
  }

  function setBanner(form, message, kind = "error") {
    const banner = form?.querySelector("[data-shirts-banner]");
    if (!banner) return;
    banner.textContent = message || "";
    banner.dataset.kind = kind;
    banner.hidden = !message;
    if (message) banner.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function setFieldError(form, name, message) {
    const input = field(form, name);
    const node = errorNode(form, name);
    if (!input || !node) return;
    node.textContent = message || "";
    node.hidden = !message;
    if (message) {
      input.setAttribute("aria-invalid", "true");
    } else {
      input.removeAttribute("aria-invalid");
    }
  }

  function clearErrors(form) {
    setBanner(form, "");
    ["nombre", "talla", "cantidad", "notas"].forEach((name) => setFieldError(form, name, ""));
  }

  function payload(form) {
    return {
      nombre: limpiar(field(form, "nombre")?.value),
      talla: limpiar(field(form, "talla")?.value).toUpperCase(),
      cantidad: Number(field(form, "cantidad")?.value || 1),
      notas: limpiar(field(form, "notas")?.value)
    };
  }

  function validate(form) {
    const data = payload(form);
    const errors = {};
    if (data.nombre.length < 2 || data.nombre.length > 80) {
      errors.nombre = "Indica el nombre de la persona que recoge la camiseta.";
    }
    if (!TALLAS.has(data.talla)) {
      errors.talla = "Elige una talla.";
    }
    if (!Number.isInteger(data.cantidad) || data.cantidad < 1 || data.cantidad > 10) {
      errors.cantidad = "Puedes reservar entre 1 y 10 camisetas.";
    }
    if (data.notas.length > 240) {
      errors.notas = "Las notas no pueden pasar de 240 caracteres.";
    }
    Object.entries(errors).forEach(([name, message]) => setFieldError(form, name, message));
    return Object.keys(errors).length === 0 ? data : null;
  }

  function applyServerErrors(form, campos) {
    Object.entries(campos || {}).forEach(([name, message]) => {
      setFieldError(form, name, message);
    });
  }

  function render() {
    roots.forEach((root) => {
      const list = root.querySelector("[data-shirts-list]");
      if (!list) return;

      if (!loaded) {
        list.hidden = true;
        setStatus(root, "Cargando camisetas...");
        return;
      }

      if (reservas.length === 0) {
        list.hidden = true;
        setStatus(root, "Aún no tienes camisetas reservadas.");
        return;
      }

      setStatus(root, "");
      list.hidden = false;
      list.textContent = "";
      reservas.forEach((reserva) => {
        const card = document.createElement("article");
        card.className = "shirt-card";
        card.innerHTML = `
          <div class="shirt-card-main">
            <span class="shirt-size"></span>
            <div>
              <h3></h3>
              <p></p>
            </div>
          </div>
          <button type="button" class="player-remove" data-shirt-delete>Quitar</button>
        `;
        card.querySelector(".shirt-size").textContent = reserva.talla;
        card.querySelector("h3").textContent = `${reserva.cantidad} camiseta${reserva.cantidad === 1 ? "" : "s"}`;
        card.querySelector("p").textContent = [reserva.nombre, reserva.notas].filter(Boolean).join(" · ");
        card.querySelector("[data-shirt-delete]").addEventListener("click", () => deleteReserva(reserva.id));
        list.appendChild(card);
      });
    });
  }

  async function loadReservas() {
    roots.forEach((root) => setStatus(root, "Cargando camisetas..."));
    try {
      const response = await fetch("/api/camisetas", {
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      if (response.status === 401) {
        reservas = [];
        loaded = false;
        render();
        return;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se han podido cargar tus camisetas.");
      reservas = Array.isArray(data.reservas) ? data.reservas : [];
      loaded = true;
      render();
    } catch (err) {
      loaded = true;
      roots.forEach((root) => setStatus(root, err instanceof Error ? err.message : "No se han podido cargar tus camisetas."));
    }
  }

  async function deleteReserva(id) {
    try {
      const response = await fetch(`/api/camisetas?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "No se ha podido borrar la reserva.");
      reservas = Array.isArray(data.reservas) ? data.reservas : [];
      loaded = true;
      render();
    } catch (err) {
      roots.forEach((root) => setStatus(root, err instanceof Error ? err.message : "No se ha podido borrar la reserva."));
    }
  }

  roots.forEach((root) => {
    const form = root.querySelector("[data-shirts-form]");
    if (!form) return;

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      clearErrors(form);

      const data = validate(form);
      if (!data) {
        setBanner(form, "Revisa los campos marcados.");
        return;
      }

      const submit = form.querySelector("[data-shirts-submit]");
      const original = submit?.textContent;
      if (submit) {
        submit.disabled = true;
        submit.setAttribute("aria-busy", "true");
        submit.textContent = "Guardando...";
      }

      try {
        const response = await fetch("/api/camisetas", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          credentials: "include",
          body: JSON.stringify(data)
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          applyServerErrors(form, body.campos);
          throw new Error(body.error || "No se ha podido guardar la reserva.");
        }
        reservas = Array.isArray(body.reservas) ? body.reservas : [];
        loaded = true;
        field(form, "talla").value = "";
        field(form, "cantidad").value = "1";
        field(form, "notas").value = "";
        setBanner(form, "Camiseta reservada.", "ok");
        render();
      } catch (err) {
        setBanner(form, err instanceof Error ? err.message : "No se ha podido guardar la reserva.");
      } finally {
        if (submit) {
          submit.disabled = false;
          submit.removeAttribute("aria-busy");
          submit.textContent = original;
        }
      }
    });
  });

  window.addEventListener("copa:auth", (event) => {
    const detail = event.detail || {};
    if (detail.loading) {
      loaded = false;
      render();
      return;
    }
    if (!detail.user) {
      loaded = false;
      reservas = [];
      render();
      return;
    }
    roots.forEach((root) => {
      const nameInput = field(root.querySelector("[data-shirts-form]"), "nombre");
      if (nameInput && !limpiar(nameInput.value)) {
        nameInput.value = detail.user.nombre || detail.user.email || "";
      }
    });
    loadReservas();
  });

  if (window.CopaAuth?.state && !window.CopaAuth.state.loading && window.CopaAuth.state.user) {
    loadReservas();
  }
})();
