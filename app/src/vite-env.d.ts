/// <reference types="vite/client" />

/** `?raw` imports return the file's text content. Used for core/ assets. */
declare module "*?raw" {
  const content: string;
  export default content;
}
