import fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const esbuild = require('esbuild')
const root = path.resolve(import.meta.dirname, '..')
const out = path.join(root, 'dist/extension')
await fs.rm(out, { recursive: true, force: true })
await fs.mkdir(out, {recursive: true})
for (const entry of ['content', 'reader']) await esbuild.build({entryPoints: [path.join(root, `src/${entry}.ts`)], outfile:path.join(out,`${entry}.js`), bundle:true, platform:'browser', format:'iife', target:'chrome102', legalComments:'inline'})
for (const [src, dest] of [['manifest.json','manifest.json'],['src/background.js','background.js'],['src/dock.css','dock.css'],['LICENSE','LICENSE'],['THIRD_PARTY_NOTICES.md','THIRD_PARTY_NOTICES.md'],['packaging/README.md','README.md'],['INSTALL-0.4.3.zh-CN.md','INSTALL.zh-CN.md']]) await fs.copyFile(path.join(root,src),path.join(out,dest))
await esbuild.build({entryPoints: [path.join(root, 'tests/api.ts')], outfile: path.join(root, 'dist/test-api.mjs'), bundle:true, platform:'node', format:'esm', target:'node18'})
console.log(`Built ${out}`)
