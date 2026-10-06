// Bundles the browser modules into public/dist with esbuild.
// The project historically served every module file individually (~38 requests);
// the bundle keeps dynamic import() boundaries, so heavy subsystems stay on demand.
import { build } from 'esbuild';

export async function buildClient({ minify = true, logLevel = 'silent' } = {}) {
  await build({
    entryPoints: ['public/js/app.js'],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    splitting: true,
    minify,
    sourcemap: false,
    outdir: 'public/dist',
    chunkNames: 'chunks/[name]-[hash]',
    logLevel,
  });
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  buildClient({ logLevel: 'info' }).catch((err) => {
    console.error('[build:client] failed:', err);
    process.exit(1);
  });
}
