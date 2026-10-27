// Site settings for production. Everything here is optional: leave a value
// empty (null) and that feature stays off, with the game working as before.

export const CONFIG = {
  // Where advertisers write to from the sponsor page.
  sponsorEmail: 'officialayushgarg@gmail.com',

  // Privacy-friendly analytics, off when null. One of:
  //   { provider: 'plausible', domain: 'ayush-0309.github.io' }
  //   { provider: 'goatcounter', code: 'latebrake' }   // latebrake.goatcounter.com
  analytics: null,

  // Ad portal. CrazyGames and Poki are detected from where the game is
  // hosted; set one here to force it. 'test' shows pretend ads so the flow
  // can be tried locally (so does adding ?platform=test to the URL).
  platform: null,

  // Online features (accounts, leaderboards, multiplayer), off when null.
  // anonKey is the project's publishable key (sb_publishable_…) or legacy
  // anon key (eyJ…); both are public. Never put a secret key here.
  supabase: {
    url: 'https://pghptqjmrmtyyxlofkll.supabase.co',
    anonKey: 'sb_publishable_gjIMjCLm51iwgVAgsSsM9w_UutI5h_a',
  },

  // Selling car colours with Dodo Payments (needs the shop Edge Function,
  // see supabase/README.md). Off until that's set up; ?online=mock turns on
  // a pretend shop for trying it locally.
  shop: false,
};
