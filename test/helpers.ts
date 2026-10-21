// テスト用の小さな glb を作る
export function makeGlb(json: Record<string, any>, bin?: Buffer): Buffer {
  const pad = (b: Buffer, fill: number) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4), fill)]) : b)
  const j = pad(Buffer.from(JSON.stringify(json)), 0x20)
  const parts = [j]
  const head = Buffer.alloc(12)
  head.write('glTF', 0, 'ascii')
  head.writeUInt32LE(2, 4)
  const ch = (len: number, type: string) => {
    const h = Buffer.alloc(8)
    h.writeUInt32LE(len, 0)
    h.write(type, 4, 'ascii')
    return h
  }
  const chunks = [ch(j.length, 'JSON'), j]
  if (bin) {
    const b = pad(bin, 0)
    chunks.push(ch(b.length, 'BIN\0'), b)
  }
  void parts
  const body = Buffer.concat(chunks)
  head.writeUInt32LE(12 + body.length, 8)
  return Buffer.concat([head, body])
}

/** float の配列を並べた bin と accessors・bufferViews を作る */
export function packAccessors(arrays: { data: number[]; type: 'SCALAR' | 'VEC3' | 'VEC4'; minmax?: boolean }[]) {
  const bufs: Buffer[] = []
  const accessors: any[] = []
  const bufferViews: any[] = []
  let off = 0
  for (const a of arrays) {
    const b = Buffer.from(new Float32Array(a.data).buffer)
    bufferViews.push({ buffer: 0, byteOffset: off, byteLength: b.length })
    const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type]
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: a.data.length / size, type: a.type, ...(a.minmax ? { min: [Math.min(...a.data)], max: [Math.max(...a.data)] } : {}) })
    bufs.push(b)
    off += b.length
  }
  const bin = Buffer.concat(bufs)
  return { bin, accessors, bufferViews, buffers: [{ byteLength: bin.length }] }
}

/** VRM 1.0 の最小のファイル（メタ情報だけ） */
export function fakeVrm(meta: Record<string, unknown> = {}): Buffer {
  return makeGlb({
    asset: { version: '2.0' },
    extensionsUsed: ['VRMC_vrm'],
    extensions: { VRMC_vrm: { specVersion: '1.0', meta: { name: 'Test', authors: ['tester'], licenseUrl: 'https://vrm.dev/licenses/1.0/', avatarPermission: 'everyone', commercialUsage: 'corporation', modification: 'allowModification', creditNotation: 'unnecessary', ...meta } } },
  })
}

/**
 * SOMA の名前の小さな骨組み（T ポーズ・回転なし）とアニメーション。腰が前へ進み、左腕が上下する。
 * gemx2glb.py が書く bones.glb と同じ形（ノード 0 = Hips、腰の translation と全部の rotation のチャンネル）。
 * headPitchDeg・headYawDeg: 頭をずっとその角度（前へ傾ける・横へ回す）にしておく
 */
export function fakeSomaGlb(frames = 30, fps = 30, { headPitchDeg = 0, headYawDeg = 0 } = {}): Buffer {
  const nodes: { name: string; t: number[]; parent: number }[] = []
  const add = (name: string, t: number[], parent: number) => (nodes.push({ name, t, parent }), nodes.length - 1)
  const hips = add('Hips', [0, 0.95, 0], -1)
  const s1 = add('Spine1', [0, 0.1, 0], hips)
  const s2 = add('Spine2', [0, 0.1, 0], s1)
  const chest = add('Chest', [0, 0.15, 0], s2)
  const neck = add('Neck1', [0, 0.15, 0], chest)
  add('Head', [0, 0.1, 0], neck)
  for (const [side, sx] of [
    ['Left', 1],
    ['Right', -1],
  ] as const) {
    const sh = add(`${side}Shoulder`, [0.05 * sx, 0.12, 0], chest)
    const arm = add(`${side}Arm`, [0.12 * sx, 0, 0], sh)
    const fore = add(`${side}ForeArm`, [0.28 * sx, 0, 0], arm)
    const hand = add(`${side}Hand`, [0.25 * sx, 0, 0], fore)
    add(`${side}HandMiddle1`, [0.04 * sx, 0, 0], hand)
    const leg = add(`${side}Leg`, [0.09 * sx, -0.05, 0], hips)
    const shin = add(`${side}Shin`, [0, -0.42, 0], leg)
    const foot = add(`${side}Foot`, [0, -0.42, 0], shin)
    add(`${side}ToeBase`, [0, -0.06, 0.12], foot)
  }
  const times = Array.from({ length: frames }, (_, i) => i / fps)
  const hipsT = times.flatMap((t) => [0, 0.95, t * 0.5])
  const arrays: { data: number[]; type: 'SCALAR' | 'VEC3' | 'VEC4'; minmax?: boolean }[] = [{ data: times, type: 'SCALAR', minmax: true }, { data: hipsT, type: 'VEC3' }]
  const leftArm = nodes.findIndex((n) => n.name === 'LeftArm')
  const head = nodes.findIndex((n) => n.name === 'Head')
  // 頭の回り: Y まわり（横）× X まわり（前）
  const [px, py] = [((headPitchDeg * Math.PI) / 180) / 2, ((headYawDeg * Math.PI) / 180) / 2]
  const headQ = [Math.cos(py) * Math.sin(px), Math.sin(py) * Math.cos(px), -Math.sin(py) * Math.sin(px), Math.cos(py) * Math.cos(px)]
  for (let j = 0; j < nodes.length; j++) {
    arrays.push({
      data: times.flatMap((t) => {
        if (j === head) return headQ
        if (j !== leftArm) return [0, 0, 0, 1]
        const a = Math.sin(t * Math.PI * 2) * 0.5
        return [0, 0, Math.sin(a / 2), Math.cos(a / 2)]
      }),
      type: 'VEC4',
    })
  }
  const pk = packAccessors(arrays)
  const json = {
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: nodes.map((n, i) => {
      const children = nodes.map((c, k) => (c.parent === i ? k : -1)).filter((k) => k >= 0)
      return { name: n.name, translation: n.t, ...(children.length ? { children } : {}) }
    }),
    animations: [
      {
        name: 'fake',
        samplers: [{ input: 0, output: 1, interpolation: 'LINEAR' }, ...nodes.map((_, j) => ({ input: 0, output: 2 + j, interpolation: 'LINEAR' }))],
        channels: [{ sampler: 0, target: { node: 0, path: 'translation' } }, ...nodes.map((_, j) => ({ sampler: 1 + j, target: { node: j, path: 'rotation' } }))],
      },
    ],
    accessors: pk.accessors,
    bufferViews: pk.bufferViews,
    buffers: pk.buffers,
  }
  return makeGlb(json, pk.bin)
}
