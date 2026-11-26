// Service worker : rend l'application installable et affiche les notifications
// (opérations à valider). Aucune donnée n'est mise en cache.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titre: e.data && e.data.text() }; }
  const titre = d.titre || "DGS Gestion";
  const fait = [
    self.registration.showNotification(titre, {
      body: d.message || "",
      icon: "/icone-192.png",
      badge: "/icone-192.png",
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      data: { lien: d.lien || "/notifications" },
    }),
  ];
  // Pastille sur l'icône de l'application installée (si le téléphone le permet).
  if ("setAppBadge" in self.navigator && typeof d.compteur === "number") {
    fait.push((d.compteur > 0 ? self.navigator.setAppBadge(d.compteur) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  e.waitUntil(Promise.all(fait));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const lien = (e.notification.data && e.notification.data.lien) || "/notifications";
  const url = new URL(lien, self.location.origin).href;
  e.waitUntil((async () => {
    const fenetres = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const f of fenetres) {
      if (new URL(f.url).origin === self.location.origin && "focus" in f) {
        await f.focus();
        if ("navigate" in f) return f.navigate(url);
        return;
      }
    }
    return self.clients.openWindow(url);
  })());
});
