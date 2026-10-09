// Imported into the generated service worker via workbox `importScripts`.
// Earlier builds registered an `api-cache` runtime cache for authenticated
// /api responses (#1705). Existing clients may still hold it, so delete it on
// activation; nothing in the current worker reads or writes that cache.
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.delete('api-cache'));
});
