import { Blob as NodeBlob } from 'node:buffer'

// This jsdom version's Blob polyfill has no .text()/.arrayBuffer() - real
// browsers have had these for years, and api.js's blob-error rehydration
// (see rehydrateBlobErrorBody) relies on .text(). Swap in Node's own Blob,
// which implements the full spec, so tests exercise the real code path
// instead of silently hitting the missing-method catch block.
if (typeof globalThis.Blob?.prototype?.text !== 'function') {
  globalThis.Blob = NodeBlob
}

if (!URL.createObjectURL) URL.createObjectURL = () => 'blob:mock-url'
if (!URL.revokeObjectURL) URL.revokeObjectURL = () => {}
