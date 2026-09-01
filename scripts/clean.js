import fs from 'node:fs'

for (const path of [
    'dist',
    'node_modules',
    'src/assets/oxigraph'
]) {
    if (fs.existsSync(path)) {
        fs.rmSync(path, { recursive: true, force: true })
    }
}
