# jsQR browser decoder

- Package: `jsqr` version `1.4.0`.
- Upstream: https://github.com/cozmo/jsQR
- Original distribution: https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js
- Unmodified local browser asset: `public/vendor/jsQR-1.4.0.js`.
- License: Apache-2.0, included in `jsQR-1.4.0.LICENSE.txt`.

The application loads this local asset when it needs software QR recognition. Camera frames and uploaded images are processed in the browser. Runtime does not fetch the decoder from a CDN; the project dependency lockfile remains unchanged.
