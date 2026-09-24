// Adaptateur de compatibilité avec le stockage de l'application GitHub existante.
// Dans un aperçu opaque, l'application reste utilisable, sans promettre de persistance.
let storagePersistent = true;
const memoryStorage = new Map();
let nativeStorage;
try {
  nativeStorage = window.localStorage;
  nativeStorage.setItem('appv4_probe', '1');
  nativeStorage.removeItem('appv4_probe');
} catch (_) { storagePersistent = false; }
const appStorage = {
  getItem(key) {
    if (storagePersistent) {
      try { return nativeStorage.getItem(key); } catch (_) { storagePersistent = false; }
    }
    return memoryStorage.get(key) ?? null;
  },
  setItem(key, value) {
    memoryStorage.set(key, String(value));
    if (storagePersistent) {
      try { nativeStorage.setItem(key, String(value)); }
      catch (_) { storagePersistent = false; document.getElementById('storage-warning').hidden = false; }
    }
  },
  removeItem(key) {
    memoryStorage.delete(key);
    if (storagePersistent) nativeStorage.removeItem(key);
  }
};
