/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_PROVIDER?: string;
  /** Backend endpoint for 1:1 facial verification. Unset: biometric verification is unavailable. */
  readonly VITE_FACE_VERIFICATION_URL?: string;
  /** 'off' when the configured provider doesn't perform liveness detection. */
  readonly VITE_FACE_VERIFICATION_LIVENESS?: string;
}
