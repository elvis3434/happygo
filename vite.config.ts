import { defineConfig, type Plugin } from 'vite';

function removeModuleType(): Plugin {
  return {
    name: 'remove-module-type',
    enforce: 'post',
    transformIndexHtml(html: string) {
      return html
        .replace(' type="module" crossorigin', ' defer');
    },
  };
}

export default defineConfig({
  base: './',
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
  },
  plugins: [removeModuleType()],
});
