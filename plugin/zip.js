// dsh-ppt-canvas — 纯 Node ZIP 读写（无第三方依赖）
//
// 只覆盖 .pptx 实际会用到的 ZIP 子集：store(0) / deflate(8) 两种压缩方法、
// 中央目录驱动的读取、无数据描述符、无 ZIP64。写出的包是确定性的（固定时间戳、
// 保持传入顺序），这样「同一个输入 → 同一份字节」，便于测试与 diff。
//
// 读取时额外保留每个 entry 的原始压缩字节（`raw`）：未修改的 entry 在写回时
// 原样复制，因此「读 → 写」不会因为重新压缩而改变未触碰部件的字节。

import { deflateRawSync, inflateRawSync } from 'node:zlib'

/** 本地文件头 / 中央目录 / EOCD 签名。 */
const SIG_LOCAL = 0x04034b50
const SIG_CENTRAL = 0x02014b50
const SIG_EOCD = 0x06054b50
const SIG_EOCD64 = 0x06064b50
const SIG_EOCD64_LOCATOR = 0x07064b50

const ZIP64_SENTINEL16 = 0xffff
const ZIP64_SENTINEL32 = 0xffffffff
const MAX_UINT32 = 0xffffffff

/** 固定 DOS 时间戳（1980-01-01 00:00:00）：输出确定性的前提。 */
const DOS_TIME = 0x0000
const DOS_DATE = 0x0021

/** 通用位标记：bit 11 = 文件名为 UTF-8。 */
const FLAG_UTF8 = 0x0800

/**
 * 解压预算（防 zip bomb）。
 *
 * 只靠 central directory 的 usize 挡不住：解压发生在比对之前，且攻击者可以把
 * usize 写小。单条上限取 256MB（PPTX 里最大的合法条目也不会超过这个量级），
 * 全包上限 1GB，留足余量又不会把宿主拖死。
 */
const MAX_ENTRY_INFLATED_BYTES = 256 * 1024 * 1024
const MAX_TOTAL_INFLATED_BYTES = 1024 * 1024 * 1024

/** 构造带稳定 code 的 Error。 */
function fail(code, message, details) {
  const error = new Error(message)
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

/** 把任意字节容器归一成 Uint8Array 视图（不复制）。 */
function asBytes(input, what) {
  if (input instanceof Uint8Array) return input
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) return input
  if (input instanceof ArrayBuffer) return new Uint8Array(input)
  throw fail('badRequest', `${what} must be a Uint8Array or Buffer`)
}

// ------------------------------------------------------------------ CRC-32

/** CRC-32 查表（懒加载，只建一次）。 */
let CRC_TABLE = null

function crcTable() {
  if (CRC_TABLE !== null) return CRC_TABLE
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  CRC_TABLE = table
  return table
}

/**
 * 计算 CRC-32（IEEE 802.3，ZIP 用的那个），返回无符号 32 位整数。
 * @param {Uint8Array|Buffer} bytes
 * @returns {number}
 */
export function crc32(bytes) {
  const data = asBytes(bytes, 'bytes')
  const table = crcTable()
  let c = -1
  for (let i = 0; i < data.length; i++) c = table[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// ------------------------------------------------------------------ 读取

/**
 * 定位 EOCD：从尾部向前扫描签名，并用「注释长度 == 到文件末尾的字节数」排除
 * 数据区里偶然出现的相同 4 字节。
 */
function findEocd(buf) {
  const min = Math.max(0, buf.length - 22 - 0xffff)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) !== SIG_EOCD) continue
    const commentLen = buf.readUInt16LE(i + 20)
    // 注释长度必须**正好**到文件末尾。原来写成 `=== || <=`，后半句让判断恒真，
    // 于是「尾部还有垃圾/伪造签名」的包也会被当成 EOCD（解析到错误偏移）。
    if (i + 22 + commentLen === buf.length) return i
  }
  return -1
}

/**
 * 深读 ZIP：返回每个 entry 的元数据 + 解压后的字节（以及原始压缩字节）。
 *
 * 数据描述符（bit 3）不影响我们：大小一律以中央目录为准。
 *
 * @param {Uint8Array|Buffer} buffer
 * @returns {Array<{name: string, method: number, crc32: number, csize: number,
 *   usize: number, localOff: number, flags: number, utf8: boolean,
 *   data: Uint8Array, raw: Uint8Array}>}
 */
export function readZipEntries(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(asBytes(buffer, 'buffer'))
  if (buf.length < 22) throw fail('badRequest', 'not a zip archive: file is shorter than the end-of-central-directory record')

  const eocd = findEocd(buf)
  if (eocd < 0) throw fail('badRequest', 'not a zip archive: end-of-central-directory record not found')

  const total = buf.readUInt16LE(eocd + 10)
  const cdSize = buf.readUInt32LE(eocd + 12)
  let cdOffset = buf.readUInt32LE(eocd + 16)

  // ZIP64：显式拒绝而不是猜。安装包/演示文稿不应该是 ZIP64。
  if (cdOffset === ZIP64_SENTINEL32 || total === ZIP64_SENTINEL16 || cdSize === ZIP64_SENTINEL32) {
    throw fail('badRequest', 'ZIP64 archives are not supported')
  }
  if (eocd >= 20 && buf.readUInt32LE(eocd - 20) === SIG_EOCD64_LOCATOR) {
    throw fail('badRequest', 'ZIP64 archives are not supported')
  }
  if (eocd >= 4 && buf.readUInt32LE(eocd - 4) === SIG_EOCD64) {
    throw fail('badRequest', 'ZIP64 archives are not supported')
  }

  const out = []
  const seen = new Set()
  /** 累计解压字节（zip bomb 预算）。 */
  let totalInflated = 0
  let p = cdOffset
  for (let i = 0; i < total; i++) {
    if (p + 46 > buf.length) throw fail('ioFailed', `truncated central directory at entry ${i}`)
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) {
      throw fail('ioFailed', `bad central directory signature at offset ${p} (entry ${i})`)
    }
    const flags = buf.readUInt16LE(p + 8)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const csize = buf.readUInt32LE(p + 20)
    const usize = buf.readUInt32LE(p + 24)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    if (csize === ZIP64_SENTINEL32 || usize === ZIP64_SENTINEL32 || localOff === ZIP64_SENTINEL32) {
      throw fail('badRequest', 'ZIP64 archives are not supported')
    }
    // 文件名按 UTF-8 解码：pptx 内部名一定是 ASCII，即使 bit11 没置位也不会错。
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    p += 46 + nameLen + extraLen + commentLen

    if (seen.has(name)) throw fail('ioFailed', `duplicate zip entry name: ${name}`)
    seen.add(name)

    // 越界检查必须在 readUInt32LE 之前：恶意/损坏的包给出越界的 localOff 时，
    // 原来会抛 RangeError（不友好的内部错误），现在给出清晰的 ioFailed。
    if (localOff + 30 > buf.length) {
      throw fail('ioFailed', `local header offset ${localOff} is outside the archive for entry ${name}`)
    }
    if (buf.readUInt32LE(localOff) !== SIG_LOCAL) {
      throw fail('ioFailed', `bad local file header for entry ${name}`)
    }
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const start = localOff + 30 + lNameLen + lExtraLen
    if (start + csize > buf.length) throw fail('ioFailed', `truncated payload for entry ${name}`)
    // 复制出独立切片：写回时可以原样复制，也不会因为 subarray 持有整个文件而延长生命周期。
    const raw = Uint8Array.prototype.slice.call(buf, start, start + csize)
    let data
    if (method === 0) {
      data = raw
    } else if (method === 8) {
      try {
        // **必须给 maxOutputLength**：只靠 central directory 里的 usize 是不够的
        // —— 解压发生在比对之前，一个几十 KB 的 entry 可以声明/实际展开到几 GB，
        // Node 会直接分配大 buffer，把宿主 OOM。上传路径（/api/files）接受任意 pptx。
        const inflated = inflateRawSync(raw, { maxOutputLength: MAX_ENTRY_INFLATED_BYTES })
        data = new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength)
      } catch (error) {
        if (error?.code === 'ERR_BUFFER_TOO_LARGE' || /maxOutputLength|too large/i.test(String(error?.message))) {
          throw fail('ioFailed', `entry ${name} inflates beyond ${MAX_ENTRY_INFLATED_BYTES} bytes; refusing (possible zip bomb)`)
        }
        throw fail('ioFailed', `cannot inflate entry ${name}: ${error.message}`)
      }
    } else {
      throw fail('badRequest', `unsupported compression method ${method} for entry ${name}`)
    }
    if (usize !== data.length) {
      throw fail('ioFailed', `central directory size mismatch for entry ${name} (expected ${usize}, got ${data.length})`)
    }
    // CRC 校验：corrupt 但长度一致的条目以前会被静默接受。
    if (crc !== undefined && crc !== 0 && crc32(data) !== crc) {
      throw fail('ioFailed', `CRC mismatch for entry ${name}`)
    }
    totalInflated += data.length
    if (totalInflated > MAX_TOTAL_INFLATED_BYTES) {
      throw fail('ioFailed', `archive inflates beyond ${MAX_TOTAL_INFLATED_BYTES} bytes in total; refusing`)
    }
    out.push({ name, method, crc32: crc, csize, usize, localOff, flags, utf8: (flags & FLAG_UTF8) !== 0, data, raw })
  }
  return out
}

/**
 * 读整个 ZIP 并解压全部 entry。
 * @param {Uint8Array|Buffer} buffer
 * @returns {Map<string, Uint8Array>}
 */
export function readZip(buffer) {
  const map = new Map()
  for (const entry of readZipEntries(buffer)) map.set(entry.name, entry.data)
  return map
}

// ------------------------------------------------------------------ 写入

/** .pptx 里用不到的路径形态直接在入口挡掉。 */
function checkName(name) {
  if (typeof name !== 'string' || name === '') throw fail('badRequest', 'zip entry name must be a non-empty string')
  if (name.includes('\\')) throw fail('badRequest', `zip entry name must use forward slashes: ${name}`)
  if (name.startsWith('/')) throw fail('badRequest', `zip entry name must be relative: ${name}`)
  if (name.split('/').includes('..')) throw fail('badRequest', `zip entry name must not contain "..": ${name}`)
}

/**
 * 写出 ZIP。
 *
 * 支持两种 entry：
 *  - `{ name, data, method? }`                      —— 普通写出（method 缺省时自动选 store/deflate）
 *  - `{ name, data, method, raw }`（readZipEntries 的产物）
 *                                                   —— 命中 `raw` 时原样复制压缩字节，
 *                                                      保证未修改的部件字节级不变
 *
 * @param {Array<{name: string, data?: Uint8Array, method?: 0|8, raw?: Uint8Array, crc32?: number}>} entries
 * @param {{method?: 0|8, level?: number}} [opts]
 * @returns {Buffer}
 */
export function writeZip(entries, opts = {}) {
  if (!Array.isArray(entries)) throw fail('badRequest', 'entries must be an array')
  const defaultMethod = opts.method === undefined ? undefined : checkMethod(opts.method)
  const level = opts.level === undefined ? 9 : opts.level
  if (!Number.isInteger(level) || level < 0 || level > 9) throw fail('badRequest', 'opts.level must be an integer 0..9')

  const names = new Set()
  const plan = []
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') throw fail('badRequest', 'each zip entry must be an object')
    checkName(entry.name)
    if (names.has(entry.name)) throw fail('badRequest', `duplicate zip entry name: ${entry.name}`)
    names.add(entry.name)

    const data = entry.data === undefined ? undefined : asBytes(entry.data, `entry ${entry.name} data`)
    const method = defaultMethod ?? (entry.method === undefined ? undefined : checkMethod(entry.method))
    let verbatim = null
    // 只有「方法一致 + 手里有原始压缩字节」时才走原样复制：csize 必须自洽。
    if (entry.raw !== undefined && method !== undefined && method === entry.method) {
      verbatim = asBytes(entry.raw, `entry ${entry.name} raw`)
    }
    if (verbatim === null && data === undefined) {
      throw fail('badRequest', `entry ${entry.name} needs data (or raw + method)`)
    }
    plan.push({ name: entry.name, data, method, verbatim, crc: entry.crc32 })
  }

  const chunks = []
  let offset = 0
  const push = chunk => { chunks.push(chunk); offset += chunk.length }

  /** 单个 entry 的本地头 + 载荷；返回中央目录需要的信息。 */
  const written = []
  for (const item of plan) {
    let method = item.method
    let payload = item.verbatim
    let usize = item.data === undefined ? undefined : item.data.length

    if (payload === null) {
      if (method === undefined) {
        // 未指定时按「压得动就压」决定：小文件 deflate 反而更大。
        const deflated = deflateRawSync(item.data, { level })
        if (deflated.length < item.data.length) {
          method = 8
          payload = new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength)
        } else {
          method = 0
          payload = item.data
        }
      } else if (method === 8) {
        const deflated = deflateRawSync(item.data, { level })
        payload = new Uint8Array(deflated.buffer, deflated.byteOffset, deflated.byteLength)
      } else {
        method = 0
        payload = item.data
      }
    }
    if (usize === undefined) usize = item.data?.length ?? payload.length
    const crc = item.crc ?? crc32(item.data ?? payload)

    if (usize > MAX_UINT32 || payload.length > MAX_UINT32 || offset > MAX_UINT32) {
      throw fail('badRequest', 'the archive would need ZIP64 (>4 GiB); refusing to write it')
    }
    if (written.length >= ZIP64_SENTINEL16) {
      throw fail('badRequest', 'the archive would need ZIP64 (>65535 entries); refusing to write it')
    }

    const nameBytes = Buffer.from(item.name, 'utf8')
    const utf8 = nameBytes.length !== item.name.length
    const flags = utf8 ? FLAG_UTF8 : 0
    const version = method === 8 ? 20 : 10

    const header = Buffer.alloc(30)
    header.writeUInt32LE(SIG_LOCAL, 0)
    header.writeUInt16LE(version, 4)
    header.writeUInt16LE(flags, 6)
    header.writeUInt16LE(method, 8)
    header.writeUInt16LE(DOS_TIME, 10)
    header.writeUInt16LE(DOS_DATE, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(payload.length, 18)
    header.writeUInt32LE(usize, 22)
    header.writeUInt16LE(nameBytes.length, 26)
    header.writeUInt16LE(0, 28) // 无 extra field：确定性输出

    written.push({
      name: item.name, nameBytes, flags, method, crc,
      csize: payload.length, usize, localOff: offset,
    })
    push(header)
    push(nameBytes)
    push(Buffer.isBuffer(payload) ? payload : Buffer.from(payload.buffer, payload.byteOffset, payload.byteLength))
  }

  const cdStart = offset
  for (const item of written) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(SIG_CENTRAL, 0)
    header.writeUInt16LE(20, 4) // version made by: MS-DOS, 2.0
    header.writeUInt16LE(item.method === 8 ? 20 : 10, 6)
    header.writeUInt16LE(item.flags, 8)
    header.writeUInt16LE(item.method, 10)
    header.writeUInt16LE(DOS_TIME, 12)
    header.writeUInt16LE(DOS_DATE, 14)
    header.writeUInt32LE(item.crc, 16)
    header.writeUInt32LE(item.csize, 20)
    header.writeUInt32LE(item.usize, 24)
    header.writeUInt16LE(item.nameBytes.length, 28)
    header.writeUInt16LE(0, 30) // extra
    header.writeUInt16LE(0, 32) // comment
    header.writeUInt16LE(0, 34) // disk number
    header.writeUInt16LE(0, 36) // internal attrs
    header.writeUInt32LE(0, 38) // external attrs
    header.writeUInt32LE(item.localOff, 42)
    push(header)
    push(item.nameBytes)
  }
  const cdSize = offset - cdStart

  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(SIG_EOCD, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(written.length, 8)
  eocd.writeUInt16LE(written.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)
  push(eocd)

  return Buffer.concat(chunks, offset)
}

function checkMethod(method) {
  if (method !== 0 && method !== 8) throw fail('badRequest', `unsupported zip compression method ${method} (only 0 and 8)`)
  return method
}
