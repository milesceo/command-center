import { migrateLegacyStorage } from './legacy';

// Imported first from main.tsx: the persisted stores read localStorage when they are created,
// so the old keys must be copied before any store module is evaluated.
try {
  migrateLegacyStorage(window.localStorage);
} catch {
  // No localStorage (blocked): nothing to migrate.
}
