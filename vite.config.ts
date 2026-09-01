import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { libInjectCss } from 'vite-plugin-lib-inject-css'

export default defineConfig({
  plugins: [
    dts({
      include: ['lib'],
      insertTypesEntry: true
    }),
    libInjectCss()
  ],
  build: {
    copyPublicDir: false,
    cssCodeSplit: true,
    lib: {
      entry: './lib/index.ts',
      formats: ['es'],
      name: 'FlatmapViewer'
    },
    sourcemap: true,
    target: 'esnext',
    rolldownOptions: {
      output: {
        dir: 'dist',
        exports: 'named'
      }
    }
  },
  optimizeDeps: {
      exclude: [
          '*.wasm'
      ]
  }
})
