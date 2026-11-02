// The currencies the car colour shop sells in, shared by tools/make-prices.mjs
// (what each colour costs in them) and tools/dodo-products.mjs (setting those
// prices on Dodo Payments). Every one is a Dodo Adaptive Currency; others pay
// in US dollars. To add one, add a row and run both tools again.
//
//   code: the currency
//   country: a country that pays in it (Dodo's checkout preview needs one)
//   wb: World Bank country codes whose price levels set its share of the list
//       price; the euro takes the average of its biggest economies
//   min: Dodo's smallest payment in it, in whole units

export const CURRENCIES = [
  { code: 'USD', country: 'US', wb: ['USA'], min: 0.5 },
  { code: 'EUR', country: 'DE', wb: ['DEU', 'FRA', 'ITA', 'ESP', 'NLD'], min: 0.5 },
  { code: 'GBP', country: 'GB', wb: ['GBR'], min: 0.3 },
  { code: 'INR', country: 'IN', wb: ['IND'], min: 5 },
  { code: 'CAD', country: 'CA', wb: ['CAN'], min: 0.5 },
  { code: 'AUD', country: 'AU', wb: ['AUS'], min: 0.5 },
  { code: 'NZD', country: 'NZ', wb: ['NZL'], min: 1 },
  { code: 'CHF', country: 'CH', wb: ['CHE'], min: 0.5 },
  { code: 'SEK', country: 'SE', wb: ['SWE'], min: 3 },
  { code: 'NOK', country: 'NO', wb: ['NOR'], min: 3 },
  { code: 'DKK', country: 'DK', wb: ['DNK'], min: 2.5 },
  { code: 'PLN', country: 'PL', wb: ['POL'], min: 2 },
  { code: 'CZK', country: 'CZ', wb: ['CZE'], min: 15 },
  { code: 'HUF', country: 'HU', wb: ['HUN'], min: 175 },
  { code: 'RON', country: 'RO', wb: ['ROU'], min: 2 },
  { code: 'TRY', country: 'TR', wb: ['TUR'], min: 20 },
  { code: 'JPY', country: 'JP', wb: ['JPN'], min: 50 },
  { code: 'KRW', country: 'KR', wb: ['KOR'], min: 50 },
  { code: 'HKD', country: 'HK', wb: ['HKG'], min: 4 },
  { code: 'SGD', country: 'SG', wb: ['SGP'], min: 0.5 },
  { code: 'MYR', country: 'MY', wb: ['MYS'], min: 4 },
  { code: 'IDR', country: 'ID', wb: ['IDN'], min: 8500 },
  { code: 'PHP', country: 'PH', wb: ['PHL'], min: 50 },
  { code: 'THB', country: 'TH', wb: ['THA'], min: 25 },
  { code: 'VND', country: 'VN', wb: ['VNM'], min: 12000 },
  { code: 'AED', country: 'AE', wb: ['ARE'], min: 2 },
  { code: 'SAR', country: 'SA', wb: ['SAU'], min: 2 },
  { code: 'QAR', country: 'QA', wb: ['QAT'], min: 3 },
  { code: 'ILS', country: 'IL', wb: ['ISR'], min: 3 },
  { code: 'EGP', country: 'EG', wb: ['EGY'], min: 50 },
  { code: 'MAD', country: 'MA', wb: ['MAR'], min: 10 },
  { code: 'ZAR', country: 'ZA', wb: ['ZAF'], min: 20 },
  { code: 'NGN', country: 'NG', wb: ['NGA'], min: 2000 },
  { code: 'BRL', country: 'BR', wb: ['BRA'], min: 0.5 },
  { code: 'MXN', country: 'MX', wb: ['MEX'], min: 10 },
  { code: 'CLP', country: 'CL', wb: ['CHL'], min: 500 },
  { code: 'PEN', country: 'PE', wb: ['PER'], min: 3 },
  { code: 'UYU', country: 'UY', wb: ['URY'], min: 50 },
  { code: 'DOP', country: 'DO', wb: ['DOM'], min: 100 },
  { code: 'CRC', country: 'CR', wb: ['CRI'], min: 500 },
  { code: 'BDT', country: 'BD', wb: ['BGD'], min: 100 },
  { code: 'LKR', country: 'LK', wb: ['LKA'], min: 300 },
  { code: 'NPR', country: 'NP', wb: ['NPL'], min: 150 },
  { code: 'KZT', country: 'KZ', wb: ['KAZ'], min: 500 },
];

// Currencies Dodo counts in whole units; it counts the rest in hundredths
// (paise, cents), even where coins are rarely used.
export const WHOLE = new Set(['CLP', 'JPY', 'KRW', 'VND']);

// An amount in Dodo's smallest unit of the currency.
export const units = (code, amount) => Math.round(amount * (WHOLE.has(code) ? 1 : 100));
