import path from 'node:path'
import { defineConfig } from 'vite'
import dts from 'vite-plugin-dts'
import { libInjectCss } from 'vite-plugin-lib-inject-css'

export default defineConfig({
  plugins: [
    dts({ include: ['lib'] }),
    libInjectCss()
  ],
  build: {
    copyPublicDir: false,
    cssCodeSplit: true,
    lib: {
      formats: ['es'],
      entry: path.resolve(__dirname, 'lib/index.ts'),
      name: 'FlatmapViewer'
    },
    target: 'esnext',
    rollupOptions: {
      output: {
        // Put chunk files at <output>/chunks
        chunkFileNames: 'chunks/[name].[hash].js',
        // Put chunk styles at <output>/assets
        assetFileNames: 'assets/[name][extname]',
        entryFileNames: '[name].js',
      }
    }
  },
  optimizeDeps: {
      esbuildOptions: {
          target: 'esnext'
      },
      exclude: [
          '*.wasm'
      ]
  }
})
