// SOMA（GEM-X の出力の 77 関節。tools/gemx2glb.py が書く bones.glb の骨の名前）→ VRM の humanoid の骨の対応表。
// - 背骨は Hips → Spine1 → Spine2 → Chest → Neck1 → Neck2 → Head。VRM の首は Neck1、頭は Head（Neck2 の回りは頭に入る。
//   to_vrma はワールドの向きから VRM の骨のローカルの回転を出すので、表に無い間の関節の回りは子の骨に入る）
// - 脚は {S}Leg（太もも）→ {S}Shin → {S}Foot → {S}ToeBase
// - 指は {S}Hand{F}1〜4 と End。1 が手のひらの中の骨（中手骨）なので、VRM の付け根・中・先は 2・3・4（1 の回りは付け根に入る）。
//   親指は Thumb1〜3 と End で、1 が VRM の Metacarpal
// - 目（{S}Eye）・あご（Jaw）は VRM の humanoid にもあるが扱わない（表情は別）

/** 左右のある骨の表を、左右それぞれの名前に広げる（{S} が Left / Right に） */
function sided(table) {
  const out = {}
  for (const side of ['Left', 'Right']) {
    for (const [bone, name] of Object.entries(table)) out[`${side.toLowerCase()}${bone}`] = name.replaceAll('{S}', side)
  }
  return out
}

/** VRM の骨の名前 → SOMA の関節の名前 */
export const SOMA_BONES = {
  hips: 'Hips',
  spine: 'Spine1',
  chest: 'Spine2',
  upperChest: 'Chest',
  neck: 'Neck1',
  head: 'Head',
  ...sided({
    UpperLeg: '{S}Leg',
    LowerLeg: '{S}Shin',
    Foot: '{S}Foot',
    Toes: '{S}ToeBase',
    Shoulder: '{S}Shoulder',
    UpperArm: '{S}Arm',
    LowerArm: '{S}ForeArm',
    Hand: '{S}Hand',
    ThumbMetacarpal: '{S}HandThumb1',
    ThumbProximal: '{S}HandThumb2',
    ThumbDistal: '{S}HandThumb3',
    ...Object.fromEntries(
      [
        ['Index', 'Index'],
        ['Middle', 'Middle'],
        ['Ring', 'Ring'],
        ['Little', 'Pinky'],
      ].flatMap(([f, n]) => [
        [`${f}Proximal`, `{S}Hand${n}2`],
        [`${f}Intermediate`, `{S}Hand${n}3`],
        [`${f}Distal`, `{S}Hand${n}4`],
      ]),
    ),
  }),
}
