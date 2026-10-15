import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative assets work on both repository Pages and custom domains.
  base: './',
  plugins: [react(), {
    name: 'development-csp',
    apply: 'serve',
    // Development needs Vite's inline refresh script. Production stays strict.
    transformIndexHtml(html) {
      return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
    },
  }],
});
