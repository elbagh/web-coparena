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

const ballWrap = document.querySelector("[data-scroll-ball]");
if (ballWrap && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const ballVideo = ballWrap.querySelector("video");
  let ballTarget = 0;
  let ballTime = 0;

  const readBallScroll = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    ballTarget = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
    ballWrap.classList.toggle("is-live", ballTarget > 0.02);
  };

  const startBall = () => {
    readBallScroll();
    ballTime = ballTarget;
    const step = () => {
      ballTime += (ballTarget - ballTime) * 0.12;
      const time = ballTime * ballVideo.duration;
      if (Math.abs(ballVideo.currentTime - time) > 0.01) {
        ballVideo.currentTime = time;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  window.addEventListener("scroll", readBallScroll, { passive: true });
  window.addEventListener("resize", readBallScroll, { passive: true });

  if (ballVideo.readyState >= 1) {
    startBall();
  } else {
    ballVideo.addEventListener("loadedmetadata", startBall, { once: true });
  }
}
