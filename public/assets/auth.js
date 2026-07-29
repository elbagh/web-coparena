(() => {
  const state = {
    user: null,
    team: null,
    verComo: null,
    /*
     * Rol y permisos efectivos, tal y como los da /api/me. Sirven para pintar:
     * ocultar una sección que no se puede usar es mejor que enseñarla y que
     * responda 403. La autorización de verdad la sigue haciendo el servidor en
     * cada endpoint; esto no es una puerta, es cortesía.
     */
    acceso: null,
    googleClientId: "",
    loading: true,
    inscripcionesAbiertas: true
  };

  /** ¿El usuario efectivo tiene este permiso? El rol admin los tiene todos. */
  function puede(permiso) {
    if (!state.acceso) return false;
    if (state.acceso.esAdmin) return true;
    return Array.isArray(state.acceso.permisos) && state.acceso.permisos.includes(permiso);
  }

  const $all = (selector) => Array.from(document.querySelectorAll(selector));

  function setHidden(selector, hidden) {
    $all(selector).forEach((element) => {
      element.hidden = hidden;
    });
  }

  function setText(selector, text) {
    $all(selector).forEach((element) => {
      element.textContent = text || "";
    });
  }

  function dispatch() {
    window.dispatchEvent(new CustomEvent("copa:auth", { detail: { ...state } }));
  }

  function getEmbeddedGoogleClientId() {
    return document.querySelector('meta[name="google-client-id"]')?.content?.trim() || "";
  }

  function renderAuthState() {
    const loggedIn = Boolean(state.user);
    const hasTeam = Boolean(state.team);
    const cerradas = !state.inscripcionesAbiertas;

    setHidden("[data-auth-loading]", !state.loading);
    setHidden("[data-auth-logged-out]", state.loading || loggedIn || cerradas);
    setHidden("[data-auth-logged-in]", state.loading || !loggedIn);
    setHidden("[data-auth-no-team]", state.loading || !loggedIn || hasTeam || cerradas);
    setHidden("[data-auth-team]", state.loading || !loggedIn || !hasTeam);
    setHidden("[data-auth-requires-no-team]", state.loading || !loggedIn || hasTeam || cerradas);
    // Solo se enseña a quien todavía no tiene equipo: quien ya está inscrito
    // sigue viendo su flujo normal para gestionarlo, cerradas o no.
    setHidden("[data-auth-cerradas]", state.loading || !cerradas || hasTeam);

    setText("[data-auth-user-name]", state.user?.nombre || state.user?.email || "");
    setText("[data-auth-user-email]", state.user?.email || "");
    setText("[data-auth-team-name]", state.team?.nombre || "");

    // Banda de «ver como»: presente en todas las páginas, oculta salvo cuando
    // la suplantación está activa.
    const verComoActivo = Boolean(state.verComo?.activo);
    setHidden("[data-ver-como]", !verComoActivo);
    setText("[data-ver-como-nombre]", state.verComo?.usuarioNombre || "");
    document.documentElement.classList.toggle("ver-como", verComoActivo);

    dispatch();
  }

  async function salirDeVerComo() {
    await fetch("/api/admin/ver-como", {
      method: "DELETE",
      headers: { Accept: "application/json" },
      credentials: "include"
    }).catch(() => {});
    // Recarga completa: media página puede estar pintada con datos del otro
    // usuario, y refrescar el estado a mano dejaría restos.
    window.location.reload();
  }

  async function refresh() {
    state.loading = true;
    renderAuthState();
    try {
      const response = await fetch("/api/me", {
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = response.ok ? await response.json() : {};
      state.user = data.user || null;
      state.team = data.team || null;
      state.verComo = data.verComo || null;
      state.acceso = data.acceso || null;
      state.inscripcionesAbiertas = data.inscripcionesAbiertas !== false;
    } catch {
      state.user = null;
      state.team = null;
      state.verComo = null;
      state.acceso = null;
    } finally {
      state.loading = false;
      renderAuthState();
    }
  }

  async function loadConfig() {
    state.googleClientId = getEmbeddedGoogleClientId();
    try {
      const response = await fetch("/api/auth/config", {
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = response.ok ? await response.json() : {};
      state.googleClientId = data.googleClientId || state.googleClientId;
    } catch {
      state.googleClientId = state.googleClientId || getEmbeddedGoogleClientId();
    }
  }

  async function loginWithCredential(credential) {
    const response = await fetch("/api/auth/google", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      credentials: "include",
      body: JSON.stringify({ credential })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "No se ha podido iniciar sesión con Google.");
    }
    await refresh();
  }

  async function logout() {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Accept: "application/json" },
      credentials: "include"
    }).catch(() => {});
    await refresh();
  }

  function waitForGoogle() {
    if (window.google?.accounts?.id) return Promise.resolve(true);
    return new Promise((resolve) => {
      let attempts = 0;
      const timer = window.setInterval(() => {
        attempts += 1;
        if (window.google?.accounts?.id) {
          window.clearInterval(timer);
          resolve(true);
        } else if (attempts > 40) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, 100);
    });
  }

  async function renderGoogleButtons() {
    const containers = $all("[data-google-login]");
    if (containers.length === 0) return;

    await loadConfig();
    if (!state.googleClientId) {
      containers.forEach((container) => {
        container.textContent = "Falta configurar GOOGLE_CLIENT_ID en Cloudflare.";
      });
      return;
    }

    const available = await waitForGoogle();
    if (!available) {
      containers.forEach((container) => {
        container.textContent = "No se ha podido cargar el botón de Google. Recarga la página.";
      });
      return;
    }

    window.google.accounts.id.initialize({
      client_id: state.googleClientId,
      callback: async (response) => {
        try {
          await loginWithCredential(response.credential);
        } catch (err) {
          $all("[data-auth-error]").forEach((element) => {
            element.textContent = err instanceof Error ? err.message : "No se ha podido iniciar sesión.";
            element.hidden = false;
          });
        }
      }
    });

    containers.forEach((container) => {
      container.textContent = "";
      window.google.accounts.id.renderButton(container, {
        type: "standard",
        theme: "outline",
        size: "large",
        shape: "pill",
        text: "signin_with",
        logo_alignment: "left"
      });
    });
  }

  $all("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      await logout();
      button.disabled = false;
    });
  });

  $all("[data-ver-como-salir]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      await salirDeVerComo();
    });
  });

  window.CopaAuth = {
    state,
    puede,
    refresh,
    logout,
    loginWithCredential,
    salirDeVerComo
  };

  renderAuthState();
  renderGoogleButtons();
  refresh();
})();
