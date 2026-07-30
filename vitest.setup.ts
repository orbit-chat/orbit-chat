import sodium from "libsodium-wrappers";

// Every export in src/lib/crypto.ts awaits sodium.ready internally, but the WASM
// init is async and shared. Awaiting once here keeps individual tests free of
// initialisation races and makes failures point at the assertion, not at setup.
await sodium.ready;
