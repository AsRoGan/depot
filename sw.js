var RELEASE = "18";
var CACHE_NAME = "depot-cache-v" + RELEASE;
var SCOPE = new URL("./", self.location.href);
var FILES_TO_CACHE = [
  "./index.html", "./style.css?v=" + RELEASE, "./app.js?v=" + RELEASE,
  "./manifest.json", "./icon-192.png", "./icon-512.png"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    Promise.all(FILES_TO_CACHE.map(function (file) {
      var url = new URL(file, SCOPE).href;
      return fetch(new Request(url, { cache: "reload" })).then(function (response) {
        if (!response.ok) throw new Error("Incomplete Depot update: " + file);
        if (file === "./index.html" || file.indexOf("./app.js") === 0 || file.indexOf("./style.css") === 0) {
          return response.clone().text().then(function (text) {
            var expected = file === "./index.html"
              ? 'name="depot-build" content="v' + RELEASE + '"'
              : file.indexOf("./app.js") === 0 ? 'var APP_VERSION = "v' + RELEASE + '"'
              : '/* Depot build v' + RELEASE + ' */';
            if (text.indexOf(expected) === -1) throw new Error("Depot release files do not match");
            return { url: url, response: response };
          });
        }
        return { url: url, response: response };
      });
    })).then(function (files) {
      return caches.open(CACHE_NAME).then(function (cache) {
        return Promise.all(files.map(function (file) { return cache.put(file.url, file.response); }));
      });
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key.indexOf("depot-cache-") === 0 && key !== CACHE_NAME; })
            .map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);
  if (url.origin !== SCOPE.origin || url.pathname.indexOf(SCOPE.pathname) !== 0) return;
  var path = url.pathname.slice(SCOPE.pathname.length);
  var asset;
  // The installed start URL and the browser's directory URL share one page.
  if (event.request.mode === "navigate" && (path === "" || path === "index.html")) asset = "./index.html";
  else if (path === "app.js" || path === "style.css") asset = "./" + path + "?v=" + RELEASE;
  else if (["manifest.json", "icon-192.png", "icon-512.png"].indexOf(path) !== -1) asset = "./" + path;
  if (!asset) return;
  event.respondWith(caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(new URL(asset, SCOPE).href);
  }).then(function (cached) { return cached || fetch(event.request); }));
});
