import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    'shared/index': 'src/shared/index.ts',
    'client/index': 'src/client/index.ts',
    'server/index': 'src/server/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  external: ['react', 'react-dom', 'react-dom/client'],
});
