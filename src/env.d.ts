/// <reference types="vite/client" />

// Add your Vite environment variables here so `import.meta.env` is typed.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AZ_FUNC_KEY?: string;
  readonly VITE_GEMINI_API_KEY?: string;
  // add other VITE_... variables as needed
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
