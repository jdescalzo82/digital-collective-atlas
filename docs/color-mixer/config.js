// Connection to the shared Toolkit Your Life account system.
//
// Leave `provider: 'local'` to run standalone (guest mode, palettes saved in
// this browser). To share Toolkit Your Life's login, set provider to 'toolkit'
// and fill in the endpoints, or replace the 'toolkit' provider in account.js
// with Toolkit's own auth SDK (Firebase, Supabase, etc.).
export const CONFIG = {
  appName: 'Pigment Lens',
  provider: 'local',
  toolkit: {
    loginUrl: null,    // e.g. 'https://toolkityourlife.com/login?next=' — current URL is appended
    logoutUrl: null,
    apiBase: null,     // e.g. 'https://toolkityourlife.com/api' — must accept the shared session cookie
  },
};
