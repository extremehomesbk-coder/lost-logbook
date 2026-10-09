import { defineConfig } from 'vite';

// base './' keeps asset URLs relative so the build works at https://<user>.github.io/<repo>/
export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: false },
});
