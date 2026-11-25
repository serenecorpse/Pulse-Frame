import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshSurfaceSampler } from "three/examples/jsm/math/MeshSurfaceSampler.js";
import type { AdvancedEffect, AdvancedFrame } from "./advanced-visualizers";

type Frame = AdvancedFrame;
interface SceneState {
  scene: THREE.Scene;
  camera: THREE.Camera;
  update: (frame: Frame, model?: Float32Array) => void;
}

let renderer: THREE.WebGLRenderer | undefined;
let glowTexture: THREE.CanvasTexture | undefined;
const scenes = new Map<AdvancedEffect, SceneState>();
function pointGlow(): THREE.CanvasTexture {
  if (!glowTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 32;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Particle glow is not supported.");
    const gradient = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.25, "rgba(255,255,255,0.8)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 32, 32);
    glowTexture = new THREE.CanvasTexture(canvas);
  }
  return glowTexture;
}
const hash = (n: number) => {
  const value = Math.sin(n * 127.1 + 74.7) * 43758.5453;
  return value - Math.floor(value);
};
const randomSphere = (i: number): THREE.Vector3 => {
  const y = hash(i * 3 + 1) * 2 - 1,
    angle = hash(i * 3 + 2) * Math.PI * 2;
  const radius = Math.sqrt(1 - y * y);
  return new THREE.Vector3(
    radius * Math.cos(angle),
    y,
    radius * Math.sin(angle),
  );
};

function camera(): THREE.PerspectiveCamera {
  const result = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  result.position.set(0, 0, 5);
  result.lookAt(0, 0, 0);
  return result;
}

function plasma(): SceneState {
  const scene = new THREE.Scene();
  const uniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uDetail: { value: 1 },
    uColor: { value: new THREE.Color() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    vertexShader: `
      uniform float uTime, uBass, uMid, uDetail;
      varying vec3 vNormal, vPosition;
      void main() {
        float wave = sin(position.x * 8.0 * uDetail + uTime * 2.0) * sin(position.y * 7.0 * uDetail - uTime * 1.7)
          * sin(position.z * 6.0 * uDetail + uTime) * (0.03 + uMid * 0.15);
        vec3 p = position * (1.0 + uBass * 0.18 + wave);
        vNormal = normalize(normalMatrix * normal);
        vPosition = p;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime, uTreble;
      uniform vec3 uColor;
      varying vec3 vNormal, vPosition;
      void main() {
        float rim = pow(1.0 - abs(vNormal.z), 2.2);
        float field = 0.5 + 0.5 * sin(vPosition.x * 15.0 + sin(vPosition.y * 12.0 + uTime * 2.0) * 2.0);
        vec3 color = uColor * (0.25 + 0.65 * field + rim * (1.5 + uTreble));
        gl_FragColor = vec4(color, 0.92);
      }`,
  });
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48), material);
  scene.add(orb);
  const sparks = new Float32Array(400 * 3);
  for (let i = 0; i < 400; i++) {
    const point = randomSphere(i).multiplyScalar(1.13 + hash(i + 100) * 0.35);
    sparks.set([point.x, point.y, point.z], i * 3);
  }
  const sparkGeometry = new THREE.BufferGeometry();
  sparkGeometry.setAttribute("position", new THREE.BufferAttribute(sparks, 3));
  const sparkMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.018,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: pointGlow(),
  });
  const particles = new THREE.Points(sparkGeometry, sparkMaterial);
  scene.add(particles);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.03, 1.045, 96),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
    }),
  );
  scene.add(ring);
  return {
    scene,
    camera: camera(),
    update(f) {
      uniforms.uTime.value = f.time * f.speed;
      uniforms.uBass.value = f.audio.bass * f.sensitivity;
      uniforms.uMid.value = f.audio.mid * f.sensitivity;
      uniforms.uTreble.value = f.audio.treble * f.sensitivity;
      uniforms.uDetail.value = f.detail;
      uniforms.uColor.value.set(f.color);
      orb.rotation.y = f.time * f.speed * 0.12;
      particles.rotation.y = -f.time * f.speed * 0.08;
      sparkMaterial.color.set(f.color);
      sparkMaterial.opacity = 0.2 + f.audio.treble * 0.8;
      sparkMaterial.size = 0.025 + f.audio.treble * 0.035;
      ring.material.color.set(f.color);
      ring.material.opacity = f.audio.beat * 0.75;
      ring.scale.setScalar(1 + (1 - f.audio.beat) * 0.35);
    },
  };
}

function swarm(): SceneState {
  const scene = new THREE.Scene(),
    count = 3300;
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    size: 0.025,
    color: 0xffffff,
    transparent: true,
    opacity: 0.8,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: pointGlow(),
  });
  scene.add(new THREE.Points(geometry, material));
  return {
    scene,
    camera: camera(),
    update(f) {
      const time = f.time * f.speed,
        expansion =
          1 + f.audio.bass * f.sensitivity * 0.35 + f.audio.beat * 0.4;
      for (let i = 0; i < count; i++) {
        const radius = Math.sqrt((i + 1) / count) * 1.65;
        const angle =
          radius * 5 +
          ((i % 4) * Math.PI) / 2 +
          time * (0.18 + f.audio.mid * 0.25);
        const scatter = f.audio.beat * f.sensitivity * 0.55;
        positions[i * 3] =
          Math.cos(angle) * radius * expansion + (hash(i + 42) - 0.5) * scatter;
        positions[i * 3 + 1] =
          Math.sin(angle) * radius * expansion + (hash(i + 91) - 0.5) * scatter;
        positions[i * 3 + 2] = (hash(i + 111) - 0.5) * 0.3;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.setDrawRange(0, Math.min(count, Math.round(2200 * f.detail)));
      material.color.set(f.color);
      material.size = 0.035 + f.audio.treble * 0.035;
      material.opacity = 0.6 + f.audio.treble * 0.4;
    },
  };
}

function terrain(): SceneState {
  const scene = new THREE.Scene(),
    cols = 42,
    rows = 30;
  const positions = new Float32Array(
    (cols * (rows + 1) + rows * (cols + 1)) * 6,
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
  });
  scene.add(new THREE.LineSegments(geometry, material));
  const view = camera();
  view.position.set(0, 2.3, 4.1);
  view.lookAt(0, 0, -0.5);
  return {
    scene,
    camera: view,
    update(f) {
      const time = f.time * f.speed * (0.7 + f.audio.mid * 0.6);
      const point = (x: number, z: number) => {
        const px = (x / cols - 0.5) * 4.5,
          pz = (z / rows - 0.5) * 5;
        const height =
          Math.sin(px * 2 + time * 0.6) *
            Math.cos(pz * 1.6 - time * 0.9) *
            (0.12 + f.audio.bass * f.sensitivity * 0.55) *
            f.detail +
          Math.sin(Math.hypot(px, pz) * 4 - time * 3) * f.audio.beat * 0.3;
        return [px, height, pz] as const;
      };
      let index = 0;
      const segment = (a: readonly number[], b: readonly number[]) => {
        positions.set(a, index);
        positions.set(b, index + 3);
        index += 6;
      };
      for (let z = 0; z <= rows; z++)
        for (let x = 0; x < cols; x++) segment(point(x, z), point(x + 1, z));
      for (let x = 0; x <= cols; x++)
        for (let z = 0; z < rows; z++) segment(point(x, z), point(x, z + 1));
      geometry.attributes.position.needsUpdate = true;
      material.color.set(f.color);
      material.opacity = Math.min(1, 0.5 + f.audio.treble * 0.5);
    },
  };
}

function shatter(): SceneState {
  const scene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(1, 24, 16).toNonIndexed();
  const attribute = geometry.getAttribute("position") as THREE.BufferAttribute;
  const original = new Float32Array(attribute.array);
  const material = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    emissive: 0x221122,
    shininess: 70,
    flatShading: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  scene.add(mesh, new THREE.AmbientLight(0xffffff, 1.3));
  const light = new THREE.DirectionalLight(0xffffff, 2);
  light.position.set(2, 3, 5);
  scene.add(light);
  return {
    scene,
    camera: camera(),
    update(f) {
      const values = attribute.array as Float32Array;
      const force =
        f.audio.beat * (0.35 + f.audio.bass * f.sensitivity) * f.detail;
      for (let i = 0; i < values.length; i += 9) {
        const x = (original[i] + original[i + 3] + original[i + 6]) / 3;
        const y = (original[i + 1] + original[i + 4] + original[i + 7]) / 3;
        const z = (original[i + 2] + original[i + 5] + original[i + 8]) / 3;
        const jitter = 1 + hash(i) * 0.5;
        for (let j = 0; j < 9; j += 3) {
          values[i + j] = original[i + j] + x * force * jitter;
          values[i + j + 1] = original[i + j + 1] + y * force * jitter;
          values[i + j + 2] = original[i + j + 2] + z * force * jitter;
        }
      }
      attribute.needsUpdate = true;
      geometry.computeVertexNormals();
      mesh.rotation.y = f.time * f.speed * (0.15 + f.audio.mid * 0.2);
      material.color.set(f.color);
      material.emissive
        .set(f.color)
        .multiplyScalar(0.1 + f.audio.treble * 0.35);
    },
  };
}

function builtInSilhouette(): Float32Array {
  const values: number[] = [];
  for (let i = 0; i < 9000 && values.length < 7200; i++) {
    const x = (hash(i * 2) - 0.5) * 2.5,
      y = (hash(i * 2 + 1) - 0.5) * 3;
    const head = (x * x) / 0.3 + (y - 0.67) ** 2 / 0.58 < 1;
    const body =
      y < 0.28 &&
      y > -1.35 &&
      (x * x) / (0.45 + (0.28 - y) * 0.5) + (y + 0.65) ** 2 / 1.3 < 1;
    if (head || body) values.push(x, y, (hash(i + 9999) - 0.5) * 0.3);
  }
  return new Float32Array(values);
}

const defaultSilhouette = builtInSilhouette();
function silhouette(): SceneState {
  const scene = new THREE.Scene(),
    capacity = 3600;
  const positions = new Float32Array(capacity * 3),
    geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: 0.028,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    map: pointGlow(),
  });
  scene.add(new THREE.Points(geometry, material));
  return {
    scene,
    camera: camera(),
    update(f, model) {
      const source = model?.length ? model : defaultSilhouette;
      const count = Math.min(
        capacity,
        Math.floor(source.length / 3),
        Math.max(100, Math.round(2400 * f.detail)),
      );
      for (let i = 0; i < count; i++) {
        const scatter = f.audio.beat * f.sensitivity * 0.55;
        const x = source[i * 3],
          y = source[i * 3 + 1],
          z = source[i * 3 + 2];
        positions[i * 3] =
          x * (1 + f.audio.bass * f.sensitivity * 0.08) +
          (hash(i + 10) - 0.5) * scatter +
          Math.sin(f.time * f.speed + i) * f.audio.mid * 0.025;
        positions[i * 3 + 1] =
          y * (1 + f.audio.bass * f.sensitivity * 0.08) +
          (hash(i + 20) - 0.5) * scatter;
        positions[i * 3 + 2] = z + (hash(i + 30) - 0.5) * scatter;
      }
      geometry.setDrawRange(0, count);
      geometry.attributes.position.needsUpdate = true;
      material.color.set(f.color);
      material.size = 0.055 + f.audio.treble * 0.045;
      material.opacity = 0.85 + f.audio.treble * 0.15;
    },
  };
}

function liquid(): SceneState {
  const scene = new THREE.Scene();
  const uniforms = {
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uDetail: { value: 1 },
    uColor: { value: new THREE.Color() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=vec4(position.xy,0.0,1.0);}`,
    fragmentShader: `
      varying vec2 vUv;
      uniform float uTime,uBass,uMid,uTreble,uBeat,uDetail;
      uniform vec3 uColor;
      void main() {
        vec2 p = (vUv - 0.5) * 2.0;
        float radius = length(p);
        float t = uTime * 0.4;
        vec2 flow = p + vec2(sin(p.y * 4.0 + t), cos(p.x * 4.0 - t)) * (0.12 + uMid * 0.25) * uDetail;
        float wave = sin(flow.x * 5.0 + sin(flow.y * 4.0 + t) * 2.0 + t);
        wave += cos(flow.y * 7.0 - sin(flow.x * 3.0 - t) * 2.0 - t);
        wave += sin((flow.x + flow.y) * 15.0 + t * 2.0) * uTreble * 0.4;
        float ink = smoothstep(-1.0, 1.3, wave);
        float ripple = sin(radius * 28.0 - t * 8.0) * uBeat * 0.25;
        vec3 other = vec3(uColor.b, uColor.r, uColor.g);
        vec3 color = mix(uColor, other, ink) * (0.4 + ink * 0.6 + ripple);
        float alpha = (1.0 - smoothstep(0.2, 1.5 + uBass * 0.3, radius)) * (0.55 + ink * 0.35);
        gl_FragColor = vec4(color, alpha);
      }`,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material));
  return {
    scene,
    camera: new THREE.Camera(),
    update(f) {
      uniforms.uTime.value = f.time * f.speed;
      uniforms.uBass.value = f.audio.bass * f.sensitivity;
      uniforms.uMid.value = f.audio.mid * f.sensitivity;
      uniforms.uTreble.value = f.audio.treble * f.sensitivity;
      uniforms.uBeat.value = f.audio.beat;
      uniforms.uDetail.value = f.detail;
      uniforms.uColor.value.set(f.color);
    },
  };
}

const factories: Partial<Record<AdvancedEffect, () => SceneState>> = {
  "plasma-orb": plasma,
  "particle-swarm": swarm,
  "wireframe-terrain": terrain,
  "liquid-ink": liquid,
  "polygon-shatter": shatter,
  "audio-silhouette": silhouette,
};

export function drawAdvanced3D(
  ctx: CanvasRenderingContext2D,
  effect: AdvancedEffect,
  frame: Frame,
  model?: Float32Array,
): void {
  const factory = factories[effect];
  if (!factory) throw new Error(`Unknown 3D visualizer: ${effect}`);
  if (!renderer)
    renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });
  if (renderer.getContext().isContextLost())
    throw new Error(
      "The WebGL context was lost. Remove the effect or reload the editor.",
    );
  let state = scenes.get(effect);
  if (!state) {
    state = factory();
    scenes.set(effect, state);
  }
  const size = Math.max(1, Math.round(Math.min(frame.width, frame.height)));
  if (renderer.domElement.width !== size || renderer.domElement.height !== size)
    renderer.setSize(size, size, false);
  renderer.setClearColor(0x000000, 0);
  state.update(frame, model);
  renderer.render(state.scene, state.camera);
  const width =
    effect === "liquid-ink" ? frame.width : Math.min(frame.width, frame.height);
  const height =
    effect === "liquid-ink"
      ? frame.height
      : Math.min(frame.width, frame.height);
  ctx.drawImage(renderer.domElement, -width / 2, -height / 2, width, height);
}

export function disposeAdvanced3D(): void {
  for (const { scene } of scenes.values())
    scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.LineSegments
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => material.dispose());
      }
    });
  scenes.clear();
  renderer?.dispose();
  glowTexture?.dispose();
  glowTexture = undefined;
  renderer = undefined;
}

export async function loadModelPoints(file: File): Promise<Float32Array> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("3D models must be smaller than 25 MB.");
  const data = await file.arrayBuffer();
  if (data.byteLength < 20) throw new Error("Invalid GLB model.");
  const header = new DataView(data);
  if (
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== data.byteLength
  )
    throw new Error("Only valid GLB 2.0 models are supported.");
  const jsonLength = header.getUint32(12, true);
  if (
    header.getUint32(16, true) !== 0x4e4f534a ||
    jsonLength > data.byteLength - 20
  )
    throw new Error("Invalid GLB model metadata.");
  const json: unknown = JSON.parse(
    new TextDecoder().decode(new Uint8Array(data, 20, jsonLength)).trim(),
  );
  if (!json || typeof json !== "object")
    throw new Error("Invalid GLB model metadata.");
  const metadata = json as {
    buffers?: { uri?: string }[];
    images?: { uri?: string }[];
  };
  if (
    [...(metadata.buffers ?? []), ...(metadata.images ?? [])].some(
      (entry) => entry.uri && !entry.uri.startsWith("data:"),
    )
  )
    throw new Error("GLB models must embed all resources.");
  const gltf = await new GLTFLoader().parseAsync(data, "");
  try {
    const meshes: THREE.Mesh[] = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh &&
        object.geometry.getAttribute("position")
      )
        meshes.push(object);
    });
    if (!meshes.length) throw new Error("The model contains no mesh surfaces.");
    const points: THREE.Vector3[] = [];
    const perMesh = Math.max(1, Math.floor(3600 / meshes.length));
    let seed = 0x6d2b79f5;
    const random = () => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) / 4294967296;
    };
    for (const mesh of meshes.slice(0, 3600)) {
      const sampler = new MeshSurfaceSampler(mesh);
      if (
        !("setRandomGenerator" in sampler) ||
        typeof sampler.setRandomGenerator !== "function"
      )
        throw new Error("Deterministic model sampling is not supported.");
      sampler.setRandomGenerator(random);
      sampler.build();
      for (let i = 0; i < perMesh; i++) {
        const point = new THREE.Vector3();
        sampler.sample(point);
        points.push(point.applyMatrix4(mesh.matrixWorld));
      }
    }
    const box = new THREE.Box3().setFromPoints(points),
      center = box.getCenter(new THREE.Vector3()),
      size = box.getSize(new THREE.Vector3());
    const max = Math.max(size.x, size.y, size.z);
    if (!Number.isFinite(max) || max <= 0)
      throw new Error("The model has no measurable surface.");
    const result = new Float32Array(points.length * 3);
    points.forEach((point, index) => {
      point.sub(center).multiplyScalar(2.6 / max);
      result[index * 3] = point.x;
      result[index * 3 + 1] = point.y;
      result[index * 3 + 2] = point.z;
    });
    return result;
  } finally {
    const images = new Set<ImageBitmap>();
    gltf.scene.traverse((object) => {
      if (
        object instanceof THREE.Mesh ||
        object instanceof THREE.Points ||
        object instanceof THREE.Line
      ) {
        object.geometry.dispose();
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        materials.forEach((material) => {
          for (const value of Object.values(material))
            if (value instanceof THREE.Texture) {
              const image: unknown = value.source.data;
              if (
                typeof ImageBitmap !== "undefined" &&
                image instanceof ImageBitmap
              )
                images.add(image);
              value.dispose();
            }
          material.dispose();
        });
      }
    });
    images.forEach((image) => image.close());
  }
}
