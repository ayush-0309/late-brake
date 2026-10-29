// The page's scrollbar: a thin white line down the right edge with a race car
// on it that drives from the very top of the window to the very bottom as the
// page scrolls (styles in scrollbar.css). Drag the car, or click the line, to
// scroll like a normal scrollbar. Loaded by the site's pages, not the game.

(() => {
  const bar = document.createElement('div');
  bar.className = 'sb';
  bar.setAttribute('aria-hidden', 'true'); // only for the mouse: keys and readers scroll the page itself
  bar.innerHTML = '<div class="sb-line"></div><div class="sb-car"></div>';
  document.body.appendChild(bar);
  const car = bar.lastChild;
  const root = document.documentElement;

  const range = () => root.scrollHeight - innerHeight; // how far the page scrolls
  const travel = () => innerHeight - car.offsetHeight; // how far the car drives

  let queued = false;
  function place() {
    queued = false;
    const max = range();
    bar.style.display = max > 0 ? '' : 'none';
    if (max > 0) car.style.transform = `translateY(${(Math.min(1, Math.max(0, scrollY / max)) * travel()).toFixed(1)}px)`;
  }
  const update = () => {
    if (!queued) { queued = true; requestAnimationFrame(place); }
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  new ResizeObserver(update).observe(document.body); // the page grows as photos and fonts load
  place();

  // Scrolls so the car's top edge is `y` pixels down the window.
  const driveTo = (y) => scrollTo({ top: Math.min(1, Math.max(0, y / travel())) * range(), behavior: 'instant' });

  let grab = null; // where on the car it was picked up
  car.addEventListener('pointerdown', (e) => {
    grab = e.clientY - car.getBoundingClientRect().top;
    car.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  car.addEventListener('pointermove', (e) => {
    if (grab !== null) driveTo(e.clientY - grab);
  });
  car.addEventListener('lostpointercapture', () => { grab = null; });
  bar.addEventListener('pointerdown', (e) => {
    if (e.target !== car) driveTo(e.clientY - car.offsetHeight / 2);
  });
})();
