// Keyboard and on-screen pedals, merged into one { throttle, brake, steer }.

const KEYS = {
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake', Space: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

export function createInput(touchRoot) {
  const held = { throttle: false, brake: false, left: false, right: false };
  const touch = { throttle: new Set(), brake: new Set(), left: new Set(), right: new Set() };
  const state = { throttle: 0, brake: 0, steer: 0 };

  addEventListener('keydown', (e) => {
    const k = KEYS[e.code];
    if (!k) return;
    held[k] = true;
    e.preventDefault();
  });
  addEventListener('keyup', (e) => {
    const k = KEYS[e.code];
    if (k) held[k] = false;
  });
  addEventListener('blur', () => {
    for (const k in held) held[k] = false;
    for (const k in touch) touch[k].clear();
  });

  // Each on-screen button tracks its own pointers, so gas + steer work together.
  if (touchRoot) {
    for (const btn of touchRoot.querySelectorAll('[data-control]')) {
      const k = btn.dataset.control;
      const down = (e) => {
        e.preventDefault();
        btn.setPointerCapture?.(e.pointerId);
        touch[k].add(e.pointerId);
        btn.classList.add('down');
      };
      const up = (e) => {
        touch[k].delete(e.pointerId);
        if (!touch[k].size) btn.classList.remove('down');
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    }
  }

  return {
    read() {
      const on = (k) => held[k] || touch[k].size > 0;
      state.throttle = on('throttle') ? 1 : 0;
      state.brake = on('brake') ? 1 : 0;
      state.steer = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
      return state;
    },
  };
}
