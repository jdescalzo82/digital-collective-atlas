// Connection to the shared Toolkit Your Life account system.
//
// On www.toolkityourlife.com the app loads the site's shared sign-in script
// (/tyl-auth.js) and saves palettes to Firestore, one document per person:
// <firebaseCollection>/<user id>, the same layout StreamSaver uses.
// Anywhere else (local testing, other hosts) that script isn't there, and the app
// falls back to guest mode with palettes saved in the browser.
export const CONFIG = {
  appName: 'Pigment Lens',
  provider: 'toolkit',            // 'toolkit' | 'local'
  authScript: '/tyl-auth.js',
  firebaseVersion: '12.19.0',     // must match the version /tyl-auth.js imports
  firebaseCollection: 'pigmentlens',
};
