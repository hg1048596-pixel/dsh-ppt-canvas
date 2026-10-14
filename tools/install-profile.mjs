// tools/install-profile.mjs — 把本插件装进 DSH 的 profile
//
// 为什么不用 `dsh plugin add` / plugin_manager.install_bundle：
//   本机 profile 的 node_modules 是用 pnpm 从 `C:\Users\<用户>\.pnpm\store\v11`
//   link 出来的，而 pnpm 11 默认找 `%LOCALAPPDATA%\pnpm\store\v11`，
//   于是 install 直接以 ERR_PNPM_UNEXPECTED_STORE 失败（profile 的 .npmrc
//   管不到 plugin manager 启动的那次 pnpm）。
//
// 本插件没有任何依赖，所以最稳的安装方式是照抄 profile 里已有插件的做法：
//   1. 在 profile/node_modules 下建一个指向本仓库的 junction；
//   2. 把包名加进 profile/package.json 的 dsh.profile.bundles。
// 两步都是幂等的，重复跑不会重复写入。
//
// 用法：<node> tools/install-profile.mjs [--profile desktop] [--uninstall]

import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PKG = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const NAME = PKG.name

const args = process.argv.slice(2)
const profileArg = args.indexOf('--profile')
const profile = profileArg === -1 ? 'desktop' : args[profileArg + 1]
const uninstall = args.includes('--uninstall')
const profileDir = join(homedir(), '.dsh', 'profiles', profile)

if (!existsSync(profileDir)) {
  console.error(`install-profile: profile not found: ${profileDir}`)
  process.exit(1)
}

const nodeModules = join(profileDir, 'node_modules')
const linkPath = join(nodeModules, NAME)
const pkgPath = join(profileDir, 'package.json')

// ---------------------------------------------------------------- 链接

if (uninstall) {
  if (existsSync(linkPath)) {
    rmSync(linkPath, { recursive: true, force: true })
    console.log(`removed junction ${linkPath}`)
  } else {
    console.log(`no junction at ${linkPath}`)
  }
} else {
  mkdirSync(nodeModules, { recursive: true })
  let linkOk = false
  try {
    const stat = lstatSync(linkPath)
    const target = stat.isSymbolicLink() ? readFileSync(`${linkPath}\\.dsh-target`, 'utf8') : null
    void target
    linkOk = true
  } catch {
    linkOk = false
  }
  if (linkOk) {
    console.log(`junction already present: ${linkPath}`)
  } else {
    // junctions 需要绝对路径；目标不存在时 Node 会抛错，所以先确认。
    if (!existsSync(ROOT)) {
      console.error(`install-profile: plugin source missing: ${ROOT}`)
      process.exit(1)
    }
    symlinkSync(ROOT, linkPath, 'junction')
    console.log(`created junction ${linkPath} -> ${ROOT}`)
  }
}

// ---------------------------------------------------------------- bundles

const profilePkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
profilePkg.dsh ??= {}
profilePkg.dsh.profile ??= {}
profilePkg.dsh.profile.bundles ??= []
const bundles = profilePkg.dsh.profile.bundles
const index = bundles.indexOf(NAME)

if (uninstall) {
  if (index !== -1) {
    bundles.splice(index, 1)
    delete profilePkg.dependencies?.[NAME]
    writeFileSync(pkgPath, `${JSON.stringify(profilePkg, null, 2)}\n`)
    console.log(`removed ${NAME} from dsh.profile.bundles`)
  } else {
    console.log(`${NAME} is not listed in dsh.profile.bundles`)
  }
} else {
  profilePkg.dependencies ??= {}
  profilePkg.dependencies[NAME] = `link:${ROOT.replace(/\\/g, '/')}`
  if (index === -1) {
    bundles.push(NAME)
    console.log(`added ${NAME} to dsh.profile.bundles`)
  } else {
    console.log(`${NAME} already listed in dsh.profile.bundles`)
  }
  writeFileSync(pkgPath, `${JSON.stringify(profilePkg, null, 2)}\n`)
  console.log(`updated ${pkgPath}`)
}

console.log('')
console.log(uninstall
  ? 'restart DSH to unload the plugin'
  : 'restart DSH (a new loader row needs a fresh boot), then look for the "▦ PPT 画布" button at the sidebar foot')
