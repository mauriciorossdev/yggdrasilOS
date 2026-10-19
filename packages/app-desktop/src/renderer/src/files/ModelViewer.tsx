import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

type Props = { relativePath: string };

type Loaded = { object: THREE.Object3D };

function extOf(path: string): string {
  return path.slice(path.lastIndexOf(".") + 1).toLowerCase();
}

// Loaders are imported on demand so only the one needed for the opened
// format lands in memory (the whole viewer is also React.lazy in FileViewer).
async function loadModel(url: string, ext: string): Promise<Loaded> {
  switch (ext) {
    case "glb":
    case "gltf": {
      const { GLTFLoader } = await import("three/addons/loaders/GLTFLoader.js");
      const gltf = await new GLTFLoader().loadAsync(url);
      return { object: gltf.scene };
    }
    case "fbx": {
      const { FBXLoader } = await import("three/addons/loaders/FBXLoader.js");
      return { object: await new FBXLoader().loadAsync(url) };
    }
    case "obj": {
      const { OBJLoader } = await import("three/addons/loaders/OBJLoader.js");
      const { MTLLoader } = await import("three/addons/loaders/MTLLoader.js");
      const loader = new OBJLoader();
      try {
        // Sibling material file with the same basename, if present.
        const mtlUrl = url.replace(/\.obj$/i, ".mtl");
        const materials = await new MTLLoader().loadAsync(mtlUrl);
        materials.preload();
        loader.setMaterials(materials);
      } catch {
        // no .mtl — plain shaded OBJ
      }
      return { object: await loader.loadAsync(url) };
    }
    case "stl": {
      const { STLLoader } = await import("three/addons/loaders/STLLoader.js");
      const geometry = await new STLLoader().loadAsync(url);
      return { object: new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0xb0b4bc })) };
    }
    case "ply": {
      const { PLYLoader } = await import("three/addons/loaders/PLYLoader.js");
      const geometry = await new PLYLoader().loadAsync(url);
      geometry.computeVertexNormals();
      const hasColors = geometry.hasAttribute("color");
      const hasFaces = geometry.getIndex() !== null || geometry.getAttribute("position").count > 0;
      if (!hasFaces) throw new Error("PLY has no geometry.");
      return {
        object: new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({ color: hasColors ? 0xffffff : 0xb0b4bc, vertexColors: hasColors }),
        ),
      };
    }
    case "dae": {
      const { ColladaLoader } = await import("three/addons/loaders/ColladaLoader.js");
      const collada = await new ColladaLoader().loadAsync(url);
      if (!collada) throw new Error("Could not parse COLLADA file.");
      return { object: collada.scene };
    }
    case "3mf": {
      const { ThreeMFLoader } = await import("three/addons/loaders/3MFLoader.js");
      return { object: await new ThreeMFLoader().loadAsync(url) };
    }
    default:
      throw new Error(`Unsupported 3D format: .${ext}`);
  }
}

function eachMaterial(mesh: THREE.Mesh, fn: (m: THREE.Material) => void) {
  (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach(fn);
}

function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    eachMaterial(mesh, (m) => {
      for (const value of Object.values(m)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      m.dispose();
    });
  });
}

export default function ModelViewer({ relativePath }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<{
    setTextures: (on: boolean) => void;
    setWireframe: (on: boolean) => void;
    setGrid: (on: boolean) => void;
    resetView: () => void;
  } | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [textures, setTextures] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [grid, setGrid] = useState(true);
  const [blenderMsg, setBlenderMsg] = useState<string | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    setStatus("loading");
    setError(null);
    setTextures(true);
    setWireframe(false);
    setGrid(true);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1e1f24);
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 10000);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.display = "block";

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2);
    key.position.set(5, 10, 7);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.8);
    fill.position.set(-6, 3, -5);
    scene.add(fill);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const gridHelper = new THREE.GridHelper(10, 20, 0x555a66, 0x2c2f38);
    scene.add(gridHelper);

    let model: THREE.Object3D | null = null;
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const plainMaterial = new THREE.MeshStandardMaterial({ color: 0xb0b4bc, roughness: 0.7, metalness: 0.05 });
    let wireframeOn = false;
    let framed: { center: THREE.Vector3; distance: number } | null = null;
    let disposed = false;
    let raf = 0;

    const applyWireframe = () => {
      plainMaterial.wireframe = wireframeOn;
      model?.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) eachMaterial(mesh, (m) => ((m as THREE.MeshStandardMaterial).wireframe = wireframeOn));
      });
    };

    const resetView = () => {
      if (!framed) return;
      const { center, distance } = framed;
      camera.position.copy(center).add(new THREE.Vector3(0.6, 0.45, 1).normalize().multiplyScalar(distance));
      controls.target.copy(center);
      controls.update();
    };

    apiRef.current = {
      setTextures: (on) => {
        model?.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (!originalMaterials.has(mesh)) originalMaterials.set(mesh, mesh.material);
          mesh.material = on ? originalMaterials.get(mesh)! : plainMaterial;
        });
        applyWireframe();
      },
      setWireframe: (on) => {
        wireframeOn = on;
        applyWireframe();
      },
      setGrid: (on) => {
        gridHelper.visible = on;
      },
      resetView,
    };

    const resize = () => {
      const w = Math.max(host.clientWidth, 1);
      const h = Math.max(host.clientHeight, 1);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const animate = () => {
      raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    loadModel(window.yggdrasil.files.fileUrl(relativePath), extOf(relativePath))
      .then(({ object }) => {
        if (disposed) {
          disposeObject(object);
          return;
        }
        model = object;
        scene.add(object);
        // Frame by bounding box, and size the grid to the model sitting on it.
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const radius = Math.max(size.length() / 2, 0.001);
        const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
        camera.near = radius / 100;
        camera.far = radius * 100;
        camera.updateProjectionMatrix();
        controls.maxDistance = radius * 50;
        gridHelper.position.set(center.x, box.min.y, center.z);
        gridHelper.scale.setScalar(Math.max(size.x, size.z, radius) / 5);
        framed = { center, distance };
        resetView();
        setStatus("ready");
      })
      .catch((err) => {
        if (disposed) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });

    return () => {
      disposed = true;
      apiRef.current = null;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      if (model) {
        // Restore originals first so they get disposed too, not just the plain stand-in.
        originalMaterials.forEach((m, mesh) => (mesh.material = m));
        disposeObject(model);
      }
      plainMaterial.dispose();
      gridHelper.geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [relativePath]);

  const toggle = (
    value: boolean,
    set: (v: boolean) => void,
    apply: "setTextures" | "setWireframe" | "setGrid",
  ) => {
    set(!value);
    apiRef.current?.[apply](!value);
  };

  const openInBlender = async () => {
    const res = await window.yggdrasil.ide.openInBlender(relativePath);
    setBlenderMsg(res.opened ? null : (res.error ?? "Could not open Blender."));
  };

  return (
    <div className="file-viewer-model">
      <div className="file-viewer-model-toolbar">
        <button
          type="button"
          className={`icon-btn${textures ? " active" : ""}`}
          onClick={() => toggle(textures, setTextures, "setTextures")}
          disabled={status !== "ready"}
          title="Toggle textures / materials"
        >
          Textures
        </button>
        <button
          type="button"
          className={`icon-btn${wireframe ? " active" : ""}`}
          onClick={() => toggle(wireframe, setWireframe, "setWireframe")}
          disabled={status !== "ready"}
        >
          Wireframe
        </button>
        <button
          type="button"
          className={`icon-btn${grid ? " active" : ""}`}
          onClick={() => toggle(grid, setGrid, "setGrid")}
          disabled={status !== "ready"}
        >
          Grid
        </button>
        <button type="button" className="icon-btn" onClick={() => apiRef.current?.resetView()} disabled={status !== "ready"}>
          Reset view
        </button>
        <span className="file-viewer-model-spacer" />
        <button type="button" className="icon-btn" onClick={() => void openInBlender()}>
          Open in Blender
        </button>
      </div>
      {blenderMsg && <p className="error file-viewer-model-msg">{blenderMsg}</p>}
      <div className="file-viewer-model-canvas" ref={hostRef}>
        {status === "loading" && <p className="muted file-viewer-model-overlay">Loading…</p>}
        {status === "error" && <p className="error file-viewer-model-overlay">{error}</p>}
      </div>
    </div>
  );
}
