import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

export default defineConfig({
  base: '/admin/ui/',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
