// Buying a car colour with Dodo Payments: the shop Edge Function starts a
// checkout session, Dodo's checkout opens over the game, and once it closes
// the function asks Dodo whether it was paid.

const CHECKOUT_JS = 'https://cdn.jsdelivr.net/npm/dodopayments-checkout@2.0.0/dist/index.js';
const PENDING = 'latebrake:checkout'; // a checkout to look up again after a reload
const WAIT = [0, 1500, 3000, 5000];   // ms before each ask while a payment is processing

let sdk = null;       // Dodo's checkout, set up once per page
let finished = null;  // ends the wait on the open checkout

// True once the colour is the player's, false if they closed checkout
// without paying. Throws while a payment is still processing.
export async function buyColour(online, colour) {
  const session = await online.startCheckout(colour.id, location.origin + location.pathname);
  // The pretend backend (?online=mock) has no checkout to open.
  if (!session.mock) {
    remember(session.sessionId);
    await openCheckout(session);
  }
  const result = await settle(online, session.sessionId);
  if (!result.paid && result.status === 'processing') {
    throw new Error('Your payment is still processing. The colour appears as soon as it clears.');
  }
  return result.paid;
}

// A checkout that a reload cut short (paying in a UPI app can do that): the
// colour id if it turned out paid, else null.
export async function resumeCheckout(online) {
  const id = read(PENDING);
  if (!id) return null;
  // Dodo's return page adds these; they're not needed once we're back.
  const url = new URL(location.href);
  for (const p of ['payment_id', 'status', 'email', 'license_key']) url.searchParams.delete(p);
  history.replaceState(history.state, '', url);
  const result = await settle(online, id).catch(() => null);
  return result?.paid ? result.colour : null;
}

// Asks until the payment settles (paid, failed or never made) or the waits
// run out; a payment still processing stays remembered for next time.
async function settle(online, sessionId) {
  let result;
  for (const ms of WAIT) {
    await new Promise((resolve) => setTimeout(resolve, ms));
    result = await online.checkPayment(sessionId);
    if (result.paid || result.status !== 'processing') break;
  }
  if (result.paid || result.status !== 'processing') remember(null);
  return result;
}

async function openCheckout(session) {
  await loadScript();
  if (!sdk) {
    sdk = window.DodoPaymentsCheckout.DodoPayments;
    // Initialize once: every call adds another message listener.
    sdk.Initialize({
      mode: session.mode,
      displayType: 'overlay',
      onEvent: ({ event_type: type }) => {
        // With manualRedirect, a finished checkout asks to go to the return
        // page instead of going there itself: stay in the game and close it.
        if (type === 'checkout.redirect_requested') sdk.Checkout.close();
        if (type === 'checkout.redirect_requested' || type === 'checkout.closed') finished?.();
      },
    });
  }
  await new Promise((resolve) => {
    finished = resolve;
    sdk.Checkout.open({ checkoutUrl: session.checkoutUrl, options: { manualRedirect: true } });
  });
  finished = null;
}

let loading = null;
function loadScript() {
  loading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = CHECKOUT_JS;
    s.onload = resolve;
    s.onerror = () => { loading = null; reject(new Error("Couldn't load the payment window. Check your connection.")); };
    document.head.appendChild(s);
  });
  return loading;
}

function read(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function remember(sessionId) {
  try {
    if (sessionId) localStorage.setItem(PENDING, sessionId);
    else localStorage.removeItem(PENDING);
  } catch {}
}
