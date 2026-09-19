/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_REPO_READ_ACCESS_TOKEN: string;
  readonly VITE_FIREBASE_ANALYTICS_API_KEY: string;
  readonly VITE_GRAFANA_FARO_URL: string;
  readonly VITE_GRAFANA_FARO_APP_NAME: string;
  readonly VITE_TRACK_DATABASE_URL: string;
  readonly VITE_TRACK_PROJECT_ID: string;
  readonly VITE_TRACK_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
