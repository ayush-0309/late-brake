// What each car colour costs in every currency the shop sells in, in whole units
// of the currency (dollars, rupees), taxes included, with the share of the US
// price that's paid there. Shown in the Garage, and charged by each colour's
// Dodo Payments product (tools/dodo-products.mjs sets them).
//
// Made by tools/make-prices.mjs from World Bank price levels and exchange
// rates, then fixed: running it again keeps these whatever exchange rates do,
// and only prices new colours and currencies (last run with the rates of
// 3 November 2026). Don't edit: reprice with the tool's --reprice.

export const PRICES = {
  USD: { green: 1.99, pearl: 2.99, purple: 3.99, pink: 4.99, volt: 6.99, gold: 9.99, coffee: 0.99 }, // 100%
  EUR: { green: 1.49, pearl: 1.99, purple: 2.99, pink: 3.49, volt: 4.99, gold: 6.99, coffee: 0.69 }, // 80%
  GBP: { green: 1.49, pearl: 1.99, purple: 2.49, pink: 3.49, volt: 4.49, gold: 6.99, coffee: 0.69 }, // 90%
  INR: { green: 99, pearl: 119, purple: 149, pink: 179, volt: 199, gold: 299, coffee: 59 }, // 30%
  CAD: { green: 2.49, pearl: 3.99, purple: 4.99, pink: 5.99, volt: 8.99, gold: 11.99, coffee: 1.19 }, // 90%
  AUD: { green: 2.49, pearl: 3.99, purple: 4.99, pink: 6.99, volt: 8.99, gold: 14.99, coffee: 1.49 }, // 95%
  NZD: { green: 2.99, pearl: 4.99, purple: 5.99, pink: 7.99, volt: 11.99, gold: 14.99, coffee: 1.49 }, // 90%
  CHF: { green: 1.79, pearl: 2.49, purple: 3.49, pink: 3.99, volt: 5.99, gold: 7.99, coffee: 0.79 }, // 100%
  SEK: { green: 17.99, pearl: 24.99, purple: 34.99, pink: 44.99, volt: 59.99, gold: 89.99, coffee: 8.99 }, // 90%
  NOK: { green: 17.99, pearl: 24.99, purple: 34.99, pink: 44.99, volt: 59.99, gold: 89.99, coffee: 8.99 }, // 95%
  DKK: { green: 11.99, pearl: 19.99, purple: 24.99, pink: 34.99, volt: 44.99, gold: 69.99, coffee: 6.99 }, // 100%
  PLN: { green: 4.49, pearl: 5.99, purple: 8.99, pink: 9.99, volt: 14.99, gold: 19.99, coffee: 2.49 }, // 55%
  CZK: { green: 29, pearl: 39, purple: 59, pink: 69, volt: 99, gold: 149, coffee: 19 }, // 65%
  HUF: { green: 399, pearl: 599, purple: 799, pink: 1000, volt: 1500, gold: 2000, coffee: 199 }, // 60%
  RON: { green: 4.99, pearl: 6.99, purple: 9.99, pink: 11.99, volt: 17.99, gold: 24.99, coffee: 2.99 }, // 50%
  TRY: { green: 59, pearl: 69, purple: 89, pink: 119, volt: 149, gold: 249, coffee: 39 }, // 45%
  JPY: { green: 199, pearl: 349, purple: 449, pink: 599, volt: 799, gold: 1200, coffee: 99 }, // 70%
  KRW: { green: 1500, pearl: 2500, purple: 3000, pink: 4000, volt: 6000, gold: 8000, coffee: 899 }, // 60%
  HKD: { green: 11.99, pearl: 17.99, purple: 24.99, pink: 29.99, volt: 39.99, gold: 59.99, coffee: 5.99 }, // 75%
  SGD: { green: 1.99, pearl: 2.99, purple: 3.99, pink: 4.99, volt: 6.99, gold: 9.99, coffee: 0.99 }, // 80%
  MYR: { green: 4.49, pearl: 4.99, purple: 5.99, pink: 6.99, volt: 9.99, gold: 14.99, coffee: 4.49 }, // 35%
  IDR: { green: 18000, pearl: 20000, purple: 25000, pink: 30000, volt: 40000, gold: 50000, coffee: 12000 }, // 30%
  PHP: { green: 69, pearl: 79, purple: 89, pink: 119, volt: 149, gold: 199, coffee: 59 }, // 35%
  THB: { green: 39, pearl: 49, purple: 59, pink: 69, volt: 79, gold: 99, coffee: 29 }, // 30%
  VND: { green: 30000, pearl: 35000, purple: 40000, pink: 45000, volt: 50000, gold: 80000, coffee: 18000 }, // 30%
  AED: { green: 4.99, pearl: 7.99, purple: 9.99, pink: 11.99, volt: 17.99, gold: 24.99, coffee: 2.49 }, // 70%
  SAR: { green: 3.99, pearl: 5.99, purple: 6.99, pink: 8.99, volt: 11.99, gold: 17.99, coffee: 2.49 }, // 50%
  QAR: { green: 4.99, pearl: 7.99, purple: 9.99, pink: 14.99, volt: 19.99, gold: 24.99, coffee: 3.49 }, // 75%
  ILS: { green: 5.99, pearl: 8.99, purple: 11.99, pink: 14.99, volt: 19.99, gold: 29.99, coffee: 3.49 }, // 100%
  EGP: { green: 59, pearl: 69, purple: 79, pink: 89, volt: 119, gold: 179, coffee: 59 }, // 30%
  MAD: { green: 11.99, pearl: 14.99, purple: 17.99, pink: 19.99, volt: 29.99, gold: 39.99, coffee: 11.99 }, // 40%
  ZAR: { green: 29, pearl: 39, purple: 49, pink: 59, volt: 69, gold: 79, coffee: 29 }, // 45%
  NGN: { green: 2000, pearl: 2500, purple: 3000, pink: 3500, volt: 4000, gold: 4500, coffee: 2000 }, // 30%
  BRL: { green: 5.99, pearl: 6.99, purple: 9.99, pink: 11.99, volt: 17.99, gold: 24.99, coffee: 3.49 }, // 45%
  MXN: { green: 19, pearl: 29, purple: 49, pink: 59, volt: 79, gold: 119, coffee: 19 }, // 60%
  CLP: { green: 1000, pearl: 1500, purple: 2000, pink: 2500, volt: 3500, gold: 5000, coffee: 599 }, // 50%
  PEN: { green: 3.99, pearl: 5.99, purple: 7.99, pink: 8.99, volt: 11.99, gold: 19.99, coffee: 3.49 }, // 55%
  UYU: { green: 59, pearl: 79, purple: 119, pink: 149, volt: 199, gold: 299, coffee: 59 }, // 70%
  DOP: { green: 119, pearl: 149, purple: 179, pink: 199, volt: 249, gold: 299, coffee: 119 }, // 40%
  CRC: { green: 599, pearl: 799, purple: 1000, pink: 1500, volt: 2000, gold: 2500, coffee: 599 }, // 60%
  BDT: { green: 149, pearl: 179, purple: 199, pink: 249, volt: 299, gold: 349, coffee: 119 }, // 30%
  LKR: { green: 349, pearl: 399, purple: 449, pink: 499, volt: 699, gold: 1000, coffee: 349 }, // 30%
  NPR: { green: 179, pearl: 199, purple: 249, pink: 299, volt: 349, gold: 449, coffee: 179 }, // 30%
  KZT: { green: 599, pearl: 699, purple: 799, pink: 899, volt: 1200, gold: 1500, coffee: 599 }, // 35%
};
