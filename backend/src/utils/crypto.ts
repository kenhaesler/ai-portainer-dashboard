// Shim — re-exports from core/utils (will be removed in Phase H)
export {
  hashPassword,
  comparePassword,
  signJwt,
  verifyJwt,
  _resetKeyCache,
} from '../core/utils/crypto.js';
