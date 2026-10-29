import { build } from 'esbuild';
const common = { bundle: true, minify: true, format: 'iife', target: ['es2017', 'safari12'], legalComments: 'none', sourcemap: false };
await build({ ...common, entryPoints: ['src/pixel.ts'], outfile: 'dist/pixel.js' });
await build({ ...common, entryPoints: ['src/checkout-loader.ts'], outfile: 'dist/checkout-loader.js' });
console.log('pixel: build ok');
