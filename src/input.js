// Keyboard, gamepad and on-screen pedals, merged into one { throttle, brake, steer }.

const KEYS = {
  ArrowUp: 'throttle', KeyW: 'throttle',
  ArrowDown: 'brake', KeyS: 'brake', Space: 'brake',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};

// Standard gamepad mapping (Xbox layout names).
const PAD = { a: 0, b: 1, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, left: 14, right: 15 };
const DEADZONE = 0.12;

// `onPad(action)` is called once per press of a gamepad menu button.
export function createInput(touchRoot, { onPad } = {}) {
  const held = { throttle: false, brake: false, left: false, right: false };
  const touch = { throttle: new Set(), brake: new Set(), left: new Set(), right: new Set() };
  const state = { throttle: 0, brake: 0, steer: 0, sens: 1, pad: false };
  const padWas = {};

  addEventListener('keydown', (e) => {
    const k = KEYS[e.code];
    if (!k || e.target.closest?.('input, select, textarea')) return;
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
    touchRoot?.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
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
        navigator.vibrate?.(8);
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

  function readPad() {
    const pads = navigator.getGamepads?.() || [];
    for (const p of pads) {
      if (!p || !p.connected) continue;
      const btn = (i) => p.buttons[i]?.value || (p.buttons[i]?.pressed ? 1 : 0);
      for (const [name, action] of [['start', 'pause'], ['back', 'restart'], ['y', 'reset']]) {
        const on = btn(PAD[name]) > 0.5;
        if (on && !padWas[name]) onPad?.(action);
        padWas[name] = on;
      }
      let steer = p.axes[0] || 0;
      // Deadzone, then a gentle curve: small stick moves give fine control.
      steer = Math.abs(steer) < DEADZONE ? 0 : Math.sign(steer) * ((Math.abs(steer) - DEADZONE) / (1 - DEADZONE)) ** 1.4;
      steer += btn(PAD.right) - btn(PAD.left);
      return {
        throttle: Math.max(btn(PAD.rt), btn(PAD.a), btn(PAD.rb)),
        brake: Math.max(btn(PAD.lt), btn(PAD.b), btn(PAD.lb)),
        steer,
      };
    }
    return null;
  }

  return {
    read() {
      const on = (k) => held[k] || touch[k].size > 0;
      const pad = readPad();
      state.pad = !!pad;
      state.throttle = Math.min(1, (on('throttle') ? 1 : 0) + (pad?.throttle || 0));
      state.brake = Math.min(1, (on('brake') ? 1 : 0) + (pad?.brake || 0));
      const steer = (on('right') ? 1 : 0) - (on('left') ? 1 : 0) + (pad?.steer || 0);
      state.steer = Math.max(-1, Math.min(1, steer));
      return state;
    },
  };
}
