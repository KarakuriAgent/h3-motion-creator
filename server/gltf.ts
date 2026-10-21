// glb（VRM・.vrma）の中身を読む: JSON の部分・float のアクセサー。VRM のメタ情報（利用条件）を 0.x と 1.0 で同じ形にそろえる
import type { Quality, VrmMeta } from './shared.js'

export interface Glb {
  json: Record<string, any>
  bin: Buffer | null
}

export function parseGlb(buf: Buffer): Glb {
  if (buf.length < 20 || buf.toString('ascii', 0, 4) !== 'glTF') throw new Error('glTF のバイナリ（.glb / .vrm / .vrma）ではありません')
  const jsonLen = buf.readUInt32LE(12)
  if (buf.toString('ascii', 16, 20) !== 'JSON') throw new Error('glb の最初のチャンクが JSON ではありません')
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLen))
  const binStart = 20 + jsonLen
  const bin = binStart + 8 <= buf.length ? buf.subarray(binStart + 8, binStart + 8 + buf.readUInt32LE(binStart)) : null
  return { json, bin }
}

export function accessor(g: Glb, index: number): Float32Array {
  const a = g.json.accessors[index]
  if (a.componentType !== 5126) throw new Error('float 以外のアクセサーには対応していません')
  const view = g.json.bufferViews[a.bufferView]
  const size = ({ SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as Record<string, number>)[a.type]
  const off = (view.byteOffset ?? 0) + (a.byteOffset ?? 0)
  const out = new Float32Array(a.count * size)
  const stride = view.byteStride ?? size * 4
  for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) out[i * size + k] = g.bin!.readFloatLE(off + i * stride + k * 4)
  return out
}

const yesNo = (v: unknown) => (v === true || v === 'Allow' ? '許可' : v === false || v === 'Disallow' ? '不許可' : '不明')

/** VRM のメタ情報を読む（VRMC_vrm = 1.0、VRM = 0.x） */
export function readVrmMeta(json: Record<string, any>): VrmMeta {
  const v1 = json.extensions?.VRMC_vrm
  const v0 = json.extensions?.VRM
  if (v1) {
    const m = v1.meta ?? {}
    const permission: Record<string, string> = { onlyAuthor: '作者のみ', onlySeparatelyLicensedPerson: '個別に許可を得た人のみ', everyone: '誰でも' }
    const commercial: Record<string, string> = { personalNonProfit: '個人の非営利のみ', personalProfit: '個人の営利まで', corporation: '法人も可' }
    const modification: Record<string, string> = { prohibited: '改変不可', allowModification: '改変可（改変物の再配布は不可）', allowModificationRedistribution: '改変・改変物の再配布とも可' }
    const meta: VrmMeta = {
      specVersion: '1.0',
      name: m.name ?? '',
      authors: m.authors ?? [],
      version: m.version,
      avatarPermission: permission[m.avatarPermission ?? 'onlyAuthor'] ?? String(m.avatarPermission),
      commercialUsage: commercial[m.commercialUsage ?? 'personalNonProfit'] ?? String(m.commercialUsage),
      modification: modification[m.modification ?? 'prohibited'] ?? String(m.modification),
      redistribution: yesNo(m.allowRedistribution ?? false),
      violent: yesNo(m.allowExcessivelyViolentUsage ?? false),
      sexual: yesNo(m.allowExcessivelySexualUsage ?? false),
      political: yesNo(m.allowPoliticalOrReligiousUsage ?? false),
      antisocial: yesNo(m.allowAntisocialOrHateUsage ?? false),
      creditNotation: m.creditNotation === 'unnecessary' ? '表記は要らない' : '表記が要る',
      licenseUrl: m.licenseUrl,
      otherLicenseUrl: m.otherLicenseUrl,
      warnings: [],
    }
    if (m.avatarPermission !== 'everyone') meta.warnings.push(`このモデルを使ってよいのは「${meta.avatarPermission}」です。自分が使ってよい人か確かめてください`)
    if ((m.commercialUsage ?? 'personalNonProfit') !== 'corporation') meta.warnings.push(`商用の範囲: ${meta.commercialUsage}`)
    if ((m.modification ?? 'prohibited') === 'prohibited') meta.warnings.push('改変不可のモデルです（見た目を写した動画を作ることが利用条件に合うか確かめてください）')
    if (m.creditNotation !== 'unnecessary') meta.warnings.push('クレジットの表記が要ります')
    return meta
  }
  if (v0) {
    const m = v0.meta ?? {}
    const permission: Record<string, string> = { OnlyAuthor: '作者のみ', ExplicitlyLicensedPerson: '個別に許可を得た人のみ', Everyone: '誰でも' }
    const license: Record<string, string> = {
      Redistribution_Prohibited: '再配布不可',
      CC0: 'CC0',
      CC_BY: 'CC BY',
      CC_BY_NC: 'CC BY-NC',
      CC_BY_SA: 'CC BY-SA',
      CC_BY_NC_SA: 'CC BY-NC-SA',
      CC_BY_ND: 'CC BY-ND',
      CC_BY_NC_ND: 'CC BY-NC-ND',
      Other: 'その他（otherLicenseUrl）',
    }
    const lic = String(m.licenseName ?? 'Redistribution_Prohibited')
    const meta: VrmMeta = {
      specVersion: '0.x',
      name: m.title ?? '',
      authors: m.author ? [m.author] : [],
      version: m.version,
      avatarPermission: permission[m.allowedUserName ?? 'OnlyAuthor'] ?? String(m.allowedUserName),
      commercialUsage: m.commercialUssageName === 'Allow' ? '商用可' : '商用不可',
      modification: /_ND$/.test(lic) ? '改変不可' : lic === 'Redistribution_Prohibited' ? '不明（ライセンス: 再配布不可）' : `ライセンス ${license[lic] ?? lic} に従う`,
      redistribution: lic === 'Redistribution_Prohibited' ? '不可' : `ライセンス ${license[lic] ?? lic} に従う`,
      violent: yesNo(m.violentUssageName),
      sexual: yesNo(m.sexualUssageName),
      licenseUrl: undefined,
      otherLicenseUrl: m.otherLicenseUrl || m.otherPermissionUrl || undefined,
      warnings: [],
    }
    if ((m.allowedUserName ?? 'OnlyAuthor') !== 'Everyone') meta.warnings.push(`このモデルを使ってよいのは「${meta.avatarPermission}」です。自分が使ってよい人か確かめてください`)
    if (m.commercialUssageName !== 'Allow') meta.warnings.push('商用不可のモデルです')
    if (/_ND$/.test(lic)) meta.warnings.push('改変不可のライセンスです（見た目を写した動画を作ることが利用条件に合うか確かめてください）')
    return meta
  }
  throw new Error('VRM ではありません（VRMC_vrm も VRM の拡張も無い）')
}

/** .vrma のアニメーションの extras（to_vrma が書く: 元の動画のどこから切り出したか・ループ・その場） */
export interface VrmaInfo {
  duration: number
  sourceStartSec: number
  loop: boolean
  inPlace: boolean
  startEndDeg: number
  startEndHipsCm: number
}

/** .vrma を読んで、長さ・元の動画の始まり・始めと終わりの姿勢の差を出す */
export function readVrmaInfo(buf: Buffer): VrmaInfo {
  const g = parseGlb(buf)
  if (!g.json.extensions?.VRMC_vrm_animation) throw new Error('VRMC_vrm_animation の拡張がありません（.vrma ではない）')
  const anim = g.json.animations?.[0]
  if (!anim) throw new Error('.vrma にアニメーションがありません')
  const ex = anim.extras?.h3MotionCreator ?? {}
  let duration = 0
  let maxDeg = 0
  let hipsCm = 0
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler]
    const times = accessor(g, s.input)
    duration = Math.max(duration, times[times.length - 1] ?? 0)
    const out = accessor(g, s.output)
    if (ch.target.path === 'rotation') {
      const n = out.length / 4
      const a = out.subarray(0, 4)
      const b = out.subarray((n - 1) * 4, n * 4)
      const dot = Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]))
      maxDeg = Math.max(maxDeg, (2 * Math.acos(dot) * 180) / Math.PI)
    } else if (ch.target.path === 'translation') {
      const n = out.length / 3
      const d = Math.hypot(out[0] - out[(n - 1) * 3], out[1] - out[(n - 1) * 3 + 1], out[2] - out[(n - 1) * 3 + 2])
      hipsCm = d * 100
    }
  }
  return {
    duration,
    sourceStartSec: Number(ex.sourceStartSec ?? 0),
    loop: !!ex.loop,
    inPlace: !!ex.inPlace,
    startEndDeg: Math.round(maxDeg * 10) / 10,
    startEndHipsCm: Math.round(hipsCm * 10) / 10,
  }
}

/** stats.json（tools/gemx2glb.py が書く）と .vrma から、画面に出す品質の目安をまとめる */
export function summarizeQuality(stats: any | null, vrma: VrmaInfo | null): Quality {
  const q: Quality = {}
  if (stats) {
    const fs = stats.footSlide ?? {}
    const slides = ['Left', 'Right'].map((s) => fs[s]?.medianCmPerSec).filter((v: unknown): v is number => typeof v === 'number')
    if (slides.length) q.footSlideCmPerSec = Math.round((slides.reduce((a, b) => a + b, 0) / slides.length) * 10) / 10
    const j = stats.jitterAccMedian ?? {}
    const wr = ['LeftHand', 'RightHand'].map((k) => j[k]).filter((v: unknown): v is number => typeof v === 'number')
    if (wr.length) q.wristJitter = Math.round((wr.reduce((a, b) => a + b, 0) / wr.length) * 10) / 10
    if (typeof stats.lowestPointCm?.median === 'number') q.lowestPointMedianCm = stats.lowestPointCm.median
  }
  if (vrma) {
    q.startEndDeg = vrma.startEndDeg
    q.startEndHipsCm = vrma.startEndHipsCm
    q.vrmaSec = Math.round(vrma.duration * 100) / 100
    q.sourceStartSec = vrma.sourceStartSec
    q.loop = vrma.loop
    q.inPlace = vrma.inPlace
  }
  return q
}
