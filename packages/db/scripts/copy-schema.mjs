/**
 * 把 src/schema.sql 复制到 dist/schema.sql。
 *
 * tsc 只编译 TypeScript，不会复制 .sql 资源。这里用 Node 而不是 `cp`，
 * 保证 Windows / macOS / Linux 下 `npm run build` 行为一致。
 */
import { copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const packageRoot = join(here, '..')

copyFileSync(join(packageRoot, 'src', 'schema.sql'), join(packageRoot, 'dist', 'schema.sql'))
