/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Set to 1/true to show the "Devnet demo" banner on the hosted demo build. */
  readonly VITE_DEVNET_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "*.jpg" {
  const src: string;
  export default src;
}
declare module "*.jpeg" {
  const src: string;
  export default src;
}
declare module "*.png" {
  const src: string;
  export default src;
}
declare module "*.webp" {
  const src: string;
  export default src;
}
declare module "*.svg" {
  const src: string;
  export default src;
}
