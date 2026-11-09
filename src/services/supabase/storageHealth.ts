/**
 * Tiny, dependency-free failure channel between the native session
 * storage adapter (secureStorage.ts, which imports expo-secure-store) and
 * the auth state (authSlice.ts). Kept separate from both so neither has to
 * import the other — and so authSlice stays loadable under `node --test`.
 */

export type SessionStorageOperation = 'read' | 'write' | 'remove';
export type SessionStorageFailureListener = (operation: SessionStorageOperation) => void;

const listeners = new Set<SessionStorageFailureListener>();

export function reportSessionStorageFailure(operation: SessionStorageOperation): void {
  listeners.forEach((listener) => {
    try {
      listener(operation);
    } catch {
      // A misbehaving listener must never break session storage itself.
    }
  });
}

export function onSessionStorageFailure(listener: SessionStorageFailureListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
