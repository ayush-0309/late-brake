// Site settings for production. Everything here is optional: leave a value
// empty (null) and that feature stays off, with the game working as before.

export const CONFIG = {
  // Where advertisers write to from the sponsor page.
  sponsorEmail: 'hello.thezerowork@outlook.com',

  // Privacy-friendly analytics, off when null. One of:
  //   { provider: 'plausible', domain: 'ayush-0309.github.io' }
  //   { provider: 'goatcounter', code: 'latebrake' }   // latebrake.goatcounter.com
  analytics: null,

  // Ad portal. CrazyGames and Poki are detected from where the game is
  // hosted; set one here to force it. 'test' shows pretend ads so the flow
  // can be tried locally (so does adding ?platform=test to the URL).
  platform: null,

  // Online features (accounts, leaderboards, multiplayer), off when null:
  //   { url: 'https://xxxx.supabase.co', anonKey: 'eyJ…' }
  supabase: null,
};
