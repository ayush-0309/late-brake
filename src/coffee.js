// "Buy the dev a coffee" on the home page. Dodo only takes payments that buy
// something, so the coffee is a car colour, Coffee (`tip` in src/medals.js),
// at about the lowest price Dodo can charge. The pop-up's button opens the
// game's Garage offering it (play.html?buy=coffee).

import { CONFIG } from './config.js';
import { track } from './analytics.js';
import { COLOURS } from './medals.js';
import { shopCurrency, priceText } from './shop.js';
import { loadSettings } from './settings.js';

const $ = (id) => document.getElementById(id);

export function initCoffee() {
  if (!CONFIG.shop || !CONFIG.supabase) return;
  const coffee = COLOURS.find((c) => c.tip);
  // The currency the Garage would show: the one picked there, else a guess from the time zone.
  const currency = shopCurrency(loadSettings().currency);
  const dialog = $('coffee');

  for (const el of document.querySelectorAll('.coffee-price')) el.textContent = priceText(coffee, currency);
  $('coffeeSwatch').style.background = coffee.paint;
  $('coffeeBtn').hidden = false;

  $('coffeeBtn').addEventListener('click', () => {
    dialog.showModal();
    track('Coffee opened', { currency });
  });
  $('coffeeBuy').addEventListener('click', () => track('Coffee to garage', { currency }));
  $('coffeeClose').addEventListener('click', () => dialog.close());
  // A click on the dim backdrop lands on the dialog itself.
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
