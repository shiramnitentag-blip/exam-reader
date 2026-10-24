const BUILD = "1.2.0-28b6785-mvmw4n15";
self.addEventListener('install', (event) => {
  const params = new URL(self.location.href).searchParams;
  if (!self.registration.active) return; // first install
  // Coming from a version from before manual updates (registered without "g"): switch over once.
  if (!params.has('g')) {
    self.skipWaiting();
    return;
  }
  if (params.get('approved') === BUILD) {
    self.skipWaiting();
    return;
  }
  event.stopImmediatePropagation(); // nothing is downloaded
  event.waitUntil(Promise.reject(new Error('update not approved by the teacher')));
});
