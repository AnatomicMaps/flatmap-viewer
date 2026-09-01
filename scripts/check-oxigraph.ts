import fs from 'node:fs'
import fsAsync from 'node:fs/promises'

const oxigraphAssetsPath = './src/assets/oxigraph'

const oxigraphFiles = [
    'web.js',
    'web.d.ts',
    'web_bg.wasm',
    'web_bg.wasm.d.ts'
]

const oxigraphInstallPath = './node_modules/oxigraph'

if (!fs.existsSync(oxigraphAssetsPath)) {
    await fs.mkdirSync(oxigraphAssetsPath, { mode: 0o755, recursive: true })
}

for (const file of oxigraphFiles) {
    const assetsFile = `${oxigraphAssetsPath}/${file}`
    if (!fs.existsSync(assetsFile)) {
        console.log(`Copying OxiGraph asset ${file} to ${oxigraphAssetsPath}`)
        const installedFile = `${oxigraphInstallPath}/${file}`
        await fsAsync.copyFile(installedFile, assetsFile)
    }
}
