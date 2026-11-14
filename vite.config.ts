import { defineConfig } from 'vite';

// Relative base: the built game runs from any path (GitHub Pages, a subfolder, a file server).
export default defineConfig({
  base: './',
  build: { target: 'es2022' },
});
