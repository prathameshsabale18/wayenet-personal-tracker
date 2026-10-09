const DATABASE_NAME = "waynenet-tracker";
const DATABASE_VERSION = 1;
const STORE_NAME = "app-state";
const STATE_KEY = "product-state";
const LEGACY_STORAGE_KEY = "waynenet_product_state_v1";

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadProductState() {
  try {
    const database = await openDatabase();
    const storedState = await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });

    if (storedState) return storedState;

    const legacyState = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacyState) return null;

    return JSON.parse(legacyState);
  } catch (error) {
    console.error("WAYNENET database read error:", error);
    try {
      const fallbackState = localStorage.getItem(LEGACY_STORAGE_KEY);
      return fallbackState ? JSON.parse(fallbackState) : null;
    } catch {
      return null;
    }
  }
}

export async function clearProductState() {
  try {
    const database = await openDatabase();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(STATE_KEY);
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
    database.close();
  } catch (error) {
    console.error("WAYNENET local tracker cleanup error:", error);
  }

  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    localStorage.removeItem("waynenet_cloud_owner");
  } catch (error) {
    console.error("WAYNENET local storage cleanup error:", error);
  }
}
