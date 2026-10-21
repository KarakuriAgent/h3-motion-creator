// ③ VRM の枠: three-vrm で VRM に .vrma を載せ、渡された時刻（元の動画の時間の軸）の姿勢を描く
import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm'
import { VRMAnimationLoaderPlugin, VRMLookAtQuaternionProxy, createVRMAnimationClip, type VRMAnimation } from '@pixiv/three-vrm-animation'

interface State {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  cam: THREE.PerspectiveCamera
  vrm: VRM
  mixer: THREE.AnimationMixer
  clip: THREE.AnimationClip
  heightM: number
}

export function VrmPane({ vrmUrl, vrmaUrl, time, sourceStartSec }: { vrmUrl: string; vrmaUrl: string; time: number; sourceStartSec: number }) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const st = useRef<State | null>(null)
  const last = useRef(0)
  const [status, setStatus] = useState('読み込み中…')

  useEffect(() => {
    let dead = false
    const el = host.current!
    const renderer = new THREE.WebGLRenderer({ canvas: canvas.current!, antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(2, devicePixelRatio))
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0xe9eaee)
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a90, 2.2))
    const sun = new THREE.DirectionalLight(0xffffff, 1.4)
    sun.position.set(1, 3, 2.5)
    scene.add(sun)
    scene.add(new THREE.GridHelper(20, 40, 0x9a9aa2, 0xc4c4cc))
    const cam = new THREE.PerspectiveCamera(30, 1, 0.05, 100)
    const loader = new GLTFLoader()
    loader.register((p) => new VRMLoaderPlugin(p))
    loader.register((p) => new VRMAnimationLoaderPlugin(p))
    const resize = () => {
      const w = el.clientWidth
      const h = el.clientHeight
      renderer.setSize(w, h)
      cam.aspect = w / h
      cam.updateProjectionMatrix()
      draw(last.current)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    ;(async () => {
      try {
        const vrm = (await loader.loadAsync(vrmUrl)).userData.vrm as VRM
        VRMUtils.rotateVRM0(vrm)
        vrm.scene.traverse((o) => (o.frustumCulled = false))
        scene.add(vrm.scene)
        // 骨を一度動かしてから大きさを測る（読み込んだ直後は範囲が大きく出る）
        vrm.update(0)
        vrm.scene.updateMatrixWorld(true)
        const box = new THREE.Box3().setFromObject(vrm.scene, true)
        const anim = (await loader.loadAsync(vrmaUrl)).userData.vrmAnimations[0] as VRMAnimation
        if (vrm.lookAt) {
          const proxy = new VRMLookAtQuaternionProxy(vrm.lookAt)
          proxy.name = 'VRMLookAtQuaternionProxy'
          vrm.scene.add(proxy)
        }
        const clip = createVRMAnimationClip(anim, vrm)
        const mixer = new THREE.AnimationMixer(vrm.scene)
        mixer.clipAction(clip).play()
        if (dead) return
        st.current = { renderer, scene, cam, vrm, mixer, clip, heightM: box.max.y }
        setStatus('')
        resize()
      } catch (e) {
        setStatus(`読めません: ${e instanceof Error ? e.message : e}`)
      }
    })()
    return () => {
      dead = true
      ro.disconnect()
      renderer.dispose()
      st.current = null
    }
  }, [vrmUrl, vrmaUrl])

  const draw = (t: number) => {
    const s = st.current
    if (!s) return
    const local = Math.max(0, Math.min(t - sourceStartSec, s.clip.duration - 1e-4))
    s.mixer.setTime(local)
    s.vrm.update(Math.min(0.1, Math.abs(t - last.current)))
    last.current = t
    s.vrm.scene.updateMatrixWorld(true)
    const hips = s.vrm.humanoid.getNormalizedBoneNode('hips')!.getWorldPosition(new THREE.Vector3())
    const vfov = THREE.MathUtils.degToRad(s.cam.fov)
    const distV = (s.heightM * 1.25) / 2 / Math.tan(vfov / 2)
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * s.cam.aspect)
    const distH = (s.heightM * 0.9) / 2 / Math.tan(hfov / 2)
    const dist = Math.max(distV, distH)
    const yaw = THREE.MathUtils.degToRad(15)
    s.cam.position.set(hips.x + Math.sin(yaw) * dist, s.heightM * 0.55, hips.z + Math.cos(yaw) * dist)
    s.cam.lookAt(hips.x, s.heightM * 0.5, hips.z)
    s.renderer.render(s.scene, s.cam)
  }

  useEffect(() => draw(time), [time, sourceStartSec])

  return (
    <div className="vrmpane" ref={host}>
      <canvas ref={canvas} />
      {status && <div className="overlay muted small">{status}</div>}
    </div>
  )
}
