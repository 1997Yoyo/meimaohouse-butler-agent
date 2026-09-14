/**
 * 按依赖顺序构建全部 workspace。
 *
 * 为什么不用 `npm run build --workspaces`：
 * npm 按 workspace 的目录顺序执行，不保证“被依赖的包”先构建。例如
 * butler-core 依赖 @meimaohouse/db，但 db 目录排在它后面，首次构建就会报
 * “Cannot find module '@meimaohouse/db'”。
 *
 * 这里读取每个包 package.json 的依赖关系做拓扑排序，保证被依赖的包先构建。
 * 以后新增包无需改动本文件，也无需调整顺序。
 *
 * 用法：npm run build（根目录）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rootPkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** 读取目录下的 package.json；不存在则返回 undefined */
function readPackage(dir) {
  const file = join(dir, 'package.json')
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** 展开 workspaces 中的一级 glob，如 packages/*、packages/agents/*、apps/* */
function expandWorkspaces(patterns) {
  const found = new Map()
  for (const pattern of patterns) {
    if (!pattern.endsWith('/*')) continue
    const base = join(root, pattern.slice(0, -2))
    if (!existsSync(base)) continue
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(base, entry.name)
      const pkg = readPackage(dir)
      if (pkg?.name) found.set(pkg.name, { dir, pkg })
    }
  }
  return found
}

const workspaces = expandWorkspaces(rootPkg.workspaces ?? [])
const names = [...workspaces.keys()]

// 只关心 workspace 内部依赖；外部依赖由 npm install 负责
const deps = new Map(
  names.map((name) => {
    const { pkg } = workspaces.get(name)
    const declared = { ...pkg.dependencies, ...pkg.devDependencies }
    return [name, names.filter((other) => other !== name && declared[other])]
  }),
)

const dependents = new Map(names.map((name) => [name, []]))
const remaining = new Map(names.map((name) => [name, deps.get(name).length]))
for (const [name, list] of deps) {
  for (const dep of list) dependents.get(dep).push(name)
}

// Kahn 拓扑排序：先构建没有任何内部依赖的包
const queue = names.filter((name) => remaining.get(name) === 0).sort()
const order = []
while (queue.length > 0) {
  const name = queue.shift()
  order.push(name)
  for (const next of dependents.get(name)) {
    remaining.set(next, remaining.get(next) - 1)
    if (remaining.get(next) === 0) queue.push(next)
  }
}

if (order.length !== names.length) {
  console.error('[build] workspace 之间存在循环依赖，无法确定构建顺序：')
  for (const [name, left] of remaining) {
    if (left > 0) console.error(`  - ${name}`)
  }
  process.exit(1)
}

console.log(`[build] 构建顺序: ${order.join(' -> ')}`)

for (const name of order) {
  const { dir, pkg } = workspaces.get(name)
  if (!pkg.scripts?.build) continue

  console.log(`\n[build] ${name}`)
  const result = spawnSync('npm run build', {
    cwd: dir,
    stdio: 'inherit',
    shell: true,
  })

  if (result.status !== 0) {
    console.error(`\n[build] ${name} 构建失败（exit ${result.status ?? 1}）`)
    process.exit(result.status ?? 1)
  }
}
