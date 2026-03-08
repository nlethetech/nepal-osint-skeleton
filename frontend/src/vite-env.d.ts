/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Type declarations for cytoscape layout plugins
declare module 'cytoscape-fcose' {
  const fcose: cytoscape.Ext
  export default fcose
}

declare module 'cytoscape-cola' {
  const cola: cytoscape.Ext
  export default cola
}
