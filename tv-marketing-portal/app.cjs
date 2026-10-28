// Startup file for cPanel "Setup Node.js App" (Phusion Passenger), which loads CommonJS.
// Passenger supplies the port itself; set BASE_PATH (e.g. /ProjectPanes) in the app's environment variables.
import('./server/index.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
