const root = document.documentElement;
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

document.querySelectorAll("[data-tilt]").forEach((card) => {
  card.addEventListener("pointermove", (event) => {
    const rect = card.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    card.style.setProperty("--tilt-x", `${(-y * 9).toFixed(2)}deg`);
    card.style.setProperty("--tilt-y", `${(x * 11).toFixed(2)}deg`);
    card.style.setProperty("--spot-x", `${event.clientX - rect.left}px`);
    card.style.setProperty("--spot-y", `${event.clientY - rect.top}px`);
  });

  card.addEventListener("pointerleave", () => {
    card.style.setProperty("--tilt-x", "0deg");
    card.style.setProperty("--tilt-y", "0deg");
  });
});

document.querySelectorAll(".button, .poster-card, .highlight-card, .timeline-item, .reserve-card").forEach((item) => {
  item.addEventListener("pointerenter", () => root.classList.add("is-hovering"));
  item.addEventListener("pointerleave", () => root.classList.remove("is-hovering"));
});
