/**
 * Draws a 3D blocking with three.js: the stand-in shapes, a floor and a sky, seen through the shot's camera, from
 * above with the camera's path, or from a point the person turns around the set. A frame of the shot's camera is
 * taken as a picture and the whole shot as a video, for a generation to start from. Only three.js's own shapes
 * are made, so a scene cannot load anything.
 */

import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import {
  cameraAt,
  poseAt,
  type PrevisScene,
  type PrevisVector,
  type PrevisView,
} from './previs-scene'

export interface PrevisRenderer {
  draw: (time: number, view: PrevisView) => void
  /** The shot's camera at a moment, as a PNG of the size asked. */
  frame: (time: number, width: number, height: number) => Promise<Blob>
  /** The whole shot through its camera, as an H.264 MP4 of the size asked. */
  video: (
    width: number,
    height: number,
    fps: number,
    progress?: (share: number) => void,
  ) => Promise<Blob>
  dispose: () => void
}

const radians = (vector: PrevisVector): PrevisVector => [
  THREE.MathUtils.degToRad(vector[0]),
  THREE.MathUtils.degToRad(vector[1]),
  THREE.MathUtils.degToRad(vector[2]),
]

function solid(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  at?: PrevisVector,
): THREE.Mesh {
  const mesh = new THREE.Mesh(geometry, material)
  if (at) mesh.position.set(...at)
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

/**
 * A person of the given standing size: head with a nose to show where it faces, neck, body, arms and legs. A
 * seated one has its hips at chair height above its position and its thighs forward.
 */
function figure(size: PrevisVector, material: THREE.Material, seated: boolean): THREE.Group {
  const [width, height, depth] = size
  const group = new THREE.Group()
  const head = Math.min(width * 0.25, height * 0.075)
  const seat = height * 0.26
  const drop = seated ? height * 0.45 - seat : 0
  const add = (geometry: THREE.BufferGeometry, x: number, y: number, z = 0) =>
    group.add(solid(geometry, material, [x, y, z]))
  add(new THREE.SphereGeometry(head, 20, 14), 0, height - head - drop)
  add(new THREE.SphereGeometry(head * 0.28, 8, 6), 0, height - head - drop, -head * 0.95)
  add(new THREE.BoxGeometry(width * 0.62, height * 0.36, depth * 0.8), 0, height * 0.63 - drop)
  const shoulders = height * 0.81
  const chin = height - head * 2
  add(
    new THREE.CylinderGeometry(head * 0.42, head * 0.5, chin - shoulders + head * 0.5, 12),
    0,
    (shoulders + chin) / 2 - drop,
  )
  for (const side of [-1, 1]) {
    add(
      new THREE.BoxGeometry(width * 0.18, height * 0.38, depth * 0.5),
      side * width * 0.42,
      height * 0.6 - drop,
    )
    const leg = width * 0.24
    if (seated) {
      add(new THREE.BoxGeometry(leg, leg, height * 0.25), side * width * 0.17, seat, -height * 0.1)
      add(new THREE.BoxGeometry(leg, seat, leg), side * width * 0.17, seat / 2, -height * 0.22)
    } else {
      add(
        new THREE.BoxGeometry(leg, height * 0.45, depth * 0.62),
        side * width * 0.17,
        height * 0.225,
      )
    }
  }
  return group
}

function shapeOf(
  shape: Exclude<PrevisScene['objects'][number]['shape'], 'figure' | 'seated'>,
): THREE.BufferGeometry {
  if (shape === 'sphere') return new THREE.SphereGeometry(0.5, 28, 18)
  if (shape === 'cylinder') return new THREE.CylinderGeometry(0.5, 0.5, 1, 28)
  if (shape === 'cone') return new THREE.ConeGeometry(0.5, 1, 28)
  return new THREE.BoxGeometry(1, 1, 1)
}

/** Draws the scene into `mount`, filling it at the frame's aspect. */
export function createPrevisRenderer(
  mount: HTMLElement,
  scene: PrevisScene,
  aspect: number,
  pathColor: string,
): PrevisRenderer {
  const world = new THREE.Scene()
  world.background = new THREE.Color(scene.sky)
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.domElement.style.display = 'block'
  mount.appendChild(renderer.domElement)

  const objects = new Map<string, THREE.Object3D>()
  const bounds = new THREE.Box3()
  for (const item of scene.objects) {
    const opacity = item.opacity ?? 1
    const material = new THREE.MeshStandardMaterial({
      color: item.color,
      roughness: 0.8,
      transparent: opacity < 1,
      opacity,
      depthWrite: opacity === 1,
    })
    let object: THREE.Object3D
    if (item.shape === 'figure' || item.shape === 'seated') {
      object = figure(item.size, material, item.shape === 'seated')
    } else {
      object = solid(shapeOf(item.shape), material)
      object.scale.set(item.size[0], item.shape === 'plane' ? 0.01 : item.size[1], item.size[2])
    }
    if (opacity < 1) object.traverse((part) => (part.castShadow = false))
    world.add(object)
    objects.set(item.id, object)
    for (const pose of [{ position: item.position, rotation: item.rotation }, ...item.moves]) {
      object.position.set(...pose.position)
      object.rotation.set(...radians(pose.rotation))
      object.updateMatrixWorld(true)
      bounds.expandByObject(object)
    }
  }
  const setBounds = bounds.clone()
  for (const key of scene.camera) bounds.expandByPoint(new THREE.Vector3(...key.position))
  const centre = bounds.getCenter(new THREE.Vector3())
  const span = Math.max(8, bounds.getSize(new THREE.Vector3()).length())

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(1000, 1000),
    new THREE.MeshStandardMaterial({ color: scene.floor, roughness: 1 }),
  )
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  world.add(floor)
  world.add(new THREE.HemisphereLight(0xffffff, 0x3a3748, 1.8))
  const sun = new THREE.DirectionalLight(0xffffff, 2.6)
  const setCentre = setBounds.getCenter(new THREE.Vector3())
  const setSpan = Math.max(4, setBounds.getSize(new THREE.Vector3()).length())
  sun.position
    .copy(setCentre)
    .add(new THREE.Vector3(0.4, 1, 0.5).normalize().multiplyScalar(setSpan * 1.5))
  sun.target.position.copy(setCentre)
  sun.castShadow = true
  Object.assign(sun.shadow.camera, {
    left: -setSpan,
    right: setSpan,
    top: setSpan,
    bottom: -setSpan,
    near: 0.1,
    far: setSpan * 4,
  })
  sun.shadow.camera.updateProjectionMatrix()
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0005
  world.add(sun, sun.target)

  const shot = new THREE.PerspectiveCamera(45, aspect, 0.05, 2000)
  shot.filmGauge = 36
  const orbit = new THREE.PerspectiveCamera(45, aspect, 0.05, 2000)
  orbit.position.copy(centre).add(new THREE.Vector3(span * 0.55, span * 0.45, span * 0.7))
  const controls = new OrbitControls(orbit, renderer.domElement)
  controls.target.copy(centre)
  controls.update()
  const top = new THREE.OrthographicCamera(
    (-span * aspect) / 2,
    (span * aspect) / 2,
    span / 2,
    -span / 2,
    0.05,
    2000,
  )
  top.up.set(0, 0, -1)
  top.position.copy(centre).add(new THREE.Vector3(0, span * 1.5, 0))
  top.lookAt(centre)

  const guides = new THREE.Group()
  guides.add(new THREE.GridHelper(Math.ceil(span * 2), Math.ceil(span * 2), 0x52525b, 0x2a2a30))
  const path = Array.from(
    { length: 121 },
    (_, index) => new THREE.Vector3(...cameraAt(scene, (scene.seconds * index) / 120).position),
  )
  guides.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(path),
      new THREE.LineBasicMaterial({ color: pathColor }),
    ),
  )
  const marker = new THREE.Group()
  const markerMaterial = new THREE.MeshBasicMaterial({ color: pathColor })
  marker.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.22, 0.36), markerMaterial))
  const lens = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.3, 4), markerMaterial)
  lens.rotation.x = -Math.PI / 2
  lens.position.z = -0.3
  marker.add(lens)
  guides.add(marker)
  world.add(guides)

  let disposed = false
  let busy = false
  let shown: { time: number; view: PrevisView } = { time: 0, view: 'camera' }

  const pose = (time: number) => {
    for (const item of scene.objects) {
      const at = poseAt(item, time, scene.easing === 'smooth')
      const object = objects.get(item.id)!
      object.position.set(...at.position)
      object.rotation.set(...radians(at.rotation))
    }
    const key = cameraAt(scene, time)
    shot.position.set(...key.position)
    const target = new THREE.Vector3(...key.target)
    if (shot.position.distanceTo(target) < 0.01)
      target.copy(shot.position).add(new THREE.Vector3(0, 0, -1))
    shot.lookAt(target)
    shot.setFocalLength(key.lens)
    marker.position.copy(shot.position)
    marker.quaternion.copy(shot.quaternion)
  }

  const render = (time: number, view: PrevisView) => {
    if (disposed) throw new Error('the blocking view is closed')
    pose(time)
    guides.visible = view !== 'camera'
    controls.enabled = view === 'orbit'
    renderer.render(world, view === 'orbit' ? orbit : view === 'top' ? top : shot)
  }

  const fit = () => {
    if (disposed || busy) return
    const width = Math.max(
      1,
      Math.min(
        mount.clientWidth,
        mount.clientHeight > 0 ? mount.clientHeight * aspect : mount.clientWidth,
      ),
    )
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(width, width / aspect)
    render(shown.time, shown.view)
  }
  const onTurn = () => {
    if (!busy && shown.view === 'orbit') render(shown.time, shown.view)
  }
  controls.addEventListener('change', onTurn)
  const observer = new ResizeObserver(fit)
  observer.observe(mount)
  fit()

  /** Draws at a size of its own, then gives the view its own size back. */
  const atSize = async <T>(width: number, height: number, draw: () => Promise<T>): Promise<T> => {
    if (busy) throw new Error('the blocking is already being drawn')
    busy = true
    renderer.setPixelRatio(1)
    renderer.setSize(width, height, false)
    shot.aspect = width / height
    shot.updateProjectionMatrix()
    try {
      return await draw()
    } finally {
      busy = false
      shot.aspect = aspect
      shot.updateProjectionMatrix()
      fit()
    }
  }

  return {
    draw(time, view) {
      shown = { time, view }
      if (!busy) render(time, view)
    },
    frame(time, width, height) {
      return atSize(width, height, () => {
        render(time, 'camera')
        return new Promise<Blob>((resolve, reject) =>
          renderer.domElement.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new Error('the frame was not encoded'))),
            'image/png',
          ),
        )
      })
    },
    async video(width, height, fps, progress) {
      const { Output, Mp4OutputFormat, BufferTarget, CanvasSource, QUALITY_HIGH, canEncodeVideo } =
        await import('mediabunny')
      const evenWidth = Math.round(width / 2) * 2
      const evenHeight = Math.round(height / 2) * 2
      if (!(await canEncodeVideo('avc', { width: evenWidth, height: evenHeight })))
        throw new Error('this window cannot encode H.264 video')
      return atSize(evenWidth, evenHeight, async () => {
        const surface = document.createElement('canvas')
        surface.width = evenWidth
        surface.height = evenHeight
        const context = surface.getContext('2d', { alpha: false })
        if (!context) throw new Error('the window cannot draw the frames')
        const target = new BufferTarget()
        const output = new Output({ format: new Mp4OutputFormat(), target })
        const source = new CanvasSource(surface, { codec: 'avc', quality: QUALITY_HIGH })
        output.addVideoTrack(source, { frameRate: fps })
        await output.start()
        const total = Math.max(1, Math.round(scene.seconds * fps))
        for (let index = 0; index < total; index++) {
          render(index / fps, 'camera')
          context.drawImage(renderer.domElement, 0, 0, evenWidth, evenHeight)
          await source.add(index / fps, 1 / fps)
          progress?.((index + 1) / total)
        }
        await output.finalize()
        if (!target.buffer) throw new Error('the video came out empty')
        return new Blob([target.buffer], { type: 'video/mp4' })
      })
    },
    dispose() {
      disposed = true
      observer.disconnect()
      controls.removeEventListener('change', onTurn)
      controls.dispose()
      const materials = new Set<THREE.Material>()
      world.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry.dispose()
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            materials.add(material)
        }
      })
      for (const material of materials) material.dispose()
      sun.shadow.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
    },
  }
}
