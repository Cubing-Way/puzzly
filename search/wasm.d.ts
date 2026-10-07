// esbuild's binary loader turns a .wasm import into its bytes (see script/build.js)
declare module "*.wasm" {
  const bytes: Uint8Array;
  export default bytes;
}
