(() => {
  const state = {
    user: null,
    team: null,
    googleClientId: "",
    loading: true
  };

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

  function renderAuthState() {
    const loggedIn = Boolean(state.user);
    const hasTeam = Boolean(state.team);

    setHidden("[data-auth-loading]", !state.loading);
    setHidden("[data-auth-logged-out]", state.loading || loggedIn);
    setHidden("[data-auth-logged-in]", state.loading || !loggedIn);
    setHidden("[data-auth-no-team]", state.loading || !loggedIn || hasTeam);
    setHidden("[data-auth-team]", state.loading || !loggedIn || !hasTeam);
    setHidden("[data-auth-requires-no-team]", state.loading || !loggedIn || hasTeam);

    setText("[data-auth-user-name]", state.user?.nombre || state.user?.email || "");
    setText("[data-auth-user-email]", state.user?.email || "");
    setText("[data-auth-team-name]", state.team?.nombre || "");
    dispatch();
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
    } catch {
      state.user = null;
      state.team = null;
    } finally {
      state.loading = false;
      renderAuthState();
    }
  }

  async function loadConfig() {
    try {
      const response = await fetch("/api/auth/config", {
        headers: { Accept: "application/json" },
        credentials: "include"
      });
      const data = response.ok ? await response.json() : {};
      state.googleClientId = data.googleClientId || "";
    } catch {
      state.googleClientId = "";
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

  window.CopaAuth = {
    state,
    refresh,
    logout,
    loginWithCredential
  };

  renderAuthState();
  renderGoogleButtons();
  refresh();
})();
