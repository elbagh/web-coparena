const root = document.documentElement;
root.classList.add("js");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const blob = document.querySelector("[data-cursor-blob]");
let blobX = 0;
let blobY = 0;
let targetX = 0;
let targetY = 0;

const animateBlob = () => {
  blobX += (targetX - blobX) * 0.16;
  blobY += (targetY - blobY) * 0.16;
  if (blob) {
    blob.style.transform = `translate3d(${blobX}px, ${blobY}px, 0)`;
  }
  requestAnimationFrame(animateBlob);
};

if (blob && window.matchMedia("(pointer: fine)").matches) {
  animateBlob();
}

window.addEventListener("pointermove", (event) => {
  const x = event.clientX;
  const y = event.clientY;
  root.style.setProperty("--pointer-x", `${x}px`);
  root.style.setProperty("--pointer-y", `${y}px`);
  targetX = x - 80;
  targetY = y - 80;
});

document.querySelectorAll(".button, .header-join, .mobile-menu a, .nav-links a, .timeline-item, .video-card").forEach((item) => {
  item.addEventListener("pointerenter", () => root.classList.add("is-hovering"));
  item.addEventListener("pointerleave", () => root.classList.remove("is-hovering"));
});

document.querySelectorAll("[data-mobile-menu]").forEach((menu) => {
  menu.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      menu.open = false;
    });
  });
});

// Parallax de las capas del escenario ([data-parallax] dentro de [data-scene]).
const parallaxLayers = [];
document.querySelectorAll("[data-scene]").forEach((scene) => {
  scene.querySelectorAll("[data-parallax]").forEach((el) => {
    const factor = parseFloat(el.dataset.parallax);
    if (factor) {
      parallaxLayers.push({ scene, el, factor });
    }
  });
});

if (parallaxLayers.length && !reduceMotion) {
  const compact = window.matchMedia("(max-width: 900px)");
  const step = () => {
    const vh = window.innerHeight;
    const scale = compact.matches ? 0.55 : 1;
    parallaxLayers.forEach((layer) => {
      const rect = layer.scene.getBoundingClientRect();
      if (rect.bottom < -120 || rect.top > vh + 120) {
        return;
      }
      const progress = (vh - rect.top) / (vh + rect.height) - 0.5;
      const shift = progress * layer.factor * 220 * scale;
      layer.el.style.transform = `translate3d(0, ${shift.toFixed(1)}px, 0)`;
    });
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Aparición de elementos .reveal al entrar en viewport.
const revealEls = document.querySelectorAll(".reveal");
if (revealEls.length) {
  if (reduceMotion || !("IntersectionObserver" in window)) {
    revealEls.forEach((el) => el.classList.add("in-view"));
  } else {
    const revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }
    );
    revealEls.forEach((el) => revealObserver.observe(el));
  }
}

// Los clips de acción se reproducen solo mientras están a la vista.
const clips = document.querySelectorAll("video[data-video-observe]");
if (clips.length && "IntersectionObserver" in window && !reduceMotion) {
  const clipObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const video = entry.target;
        if (entry.isIntersecting) {
          video.play().catch(() => {});
        } else {
          video.pause();
        }
      });
    },
    { threshold: 0.35 }
  );
  clips.forEach((clip) => clipObserver.observe(clip));
}
