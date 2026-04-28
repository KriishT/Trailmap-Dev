"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";

export function ThreeBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const W = canvas.clientWidth || 600;
    const H = canvas.clientHeight || 600;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.setClearColor(0x0F0C0A, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(48, W / H, 0.1, 5000);
    camera.position.set(0, 55, 480);
    camera.lookAt(0, 0, 0);

    const mouse = new THREE.Vector2(0, 0);
    const camTarget = new THREE.Vector2(0, 0);

    const onMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouse.x = ((e.clientX - rect.left) / rect.width - 0.5);
      mouse.y = -((e.clientY - rect.top) / rect.height - 0.5);
    };
    window.addEventListener("mousemove", onMouse);

    // Event horizon
    const horizon = new THREE.Mesh(
      new THREE.SphereGeometry(55, 64, 64),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    scene.add(horizon);

    // Outer glow spheres
    [[72, "#FFB085", 0.05], [95, "#E8754A", 0.025], [130, "#7C6FE0", 0.015]].forEach(([r, c, o]) => {
      scene.add(new THREE.Mesh(
        new THREE.SphereGeometry(r as number, 48, 48),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(c as string), transparent: true, opacity: o as number, side: THREE.BackSide })
      ));
    });

    // Accretion disk
    const diskGroup = new THREE.Group();
    diskGroup.rotation.x = Math.PI / 2.6;
    scene.add(diskGroup);

    const diskDef = [
      { r: 58,  w: 0.08, col: "#FFFFFF",  op: 0.95 },
      { r: 62,  w: 0.1,  col: "#FFF3E0",  op: 0.9  },
      { r: 70,  w: 0.12, col: "#FFD4A3",  op: 0.8  },
      { r: 82,  w: 0.14, col: "#FFB085",  op: 0.65 },
      { r: 98,  w: 0.15, col: "#E8754A",  op: 0.5  },
      { r: 116, w: 0.14, col: "#C45E35",  op: 0.35 },
      { r: 140, w: 0.13, col: "#7C6FE0",  op: 0.18 },
      { r: 168, w: 0.12, col: "#5B4FCE",  op: 0.1  },
      { r: 200, w: 0.1,  col: "#3D3080",  op: 0.05 },
    ];
    diskDef.forEach(({ r, w, col, op }) => {
      const inner = r, outer = r + r * w;
      diskGroup.add(new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 256),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(col), transparent: true, opacity: op, side: THREE.DoubleSide, depthWrite: false })
      ));
    });

    // Orbiting particles
    const N = 500;
    const oPos = new Float32Array(N * 3);
    const oData: { r: number; a: number; spd: number; y: number }[] = [];
    for (let i = 0; i < N; i++) {
      const r = 60 + Math.random() * 170;
      const a = Math.random() * Math.PI * 2;
      oData.push({ r, a, spd: (0.003 + Math.random() * 0.004) / Math.sqrt(r / 60), y: (Math.random() - 0.5) * 6 });
      oPos[i * 3] = Math.cos(a) * r;
      oPos[i * 3 + 1] = oData[i].y;
      oPos[i * 3 + 2] = Math.sin(a) * r;
    }
    const oGeo = new THREE.BufferGeometry();
    oGeo.setAttribute("position", new THREE.BufferAttribute(oPos, 3));
    diskGroup.add(new THREE.Points(oGeo, new THREE.PointsMaterial({ color: new THREE.Color("#FFD4A3"), size: 1.2, transparent: true, opacity: 0.75, sizeAttenuation: true })));

    // Spiral streams
    for (let s = 0; s < 3; s++) {
      const pts: THREE.Vector3[] = [];
      const a0 = (s / 3) * Math.PI * 2;
      for (let i = 0; i < 100; i++) {
        const t = i / 100;
        const r = 210 * (1 - t * 0.78);
        const a = a0 + t * Math.PI * 2 * 2.5;
        pts.push(new THREE.Vector3(Math.cos(a) * r, (Math.random() - 0.5) * 3 * (1 - t), Math.sin(a) * r));
      }
      diskGroup.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: new THREE.Color("#FFB085"), transparent: true, opacity: 0.15 })
      ));
    }

    // Stars
    const sPos = new Float32Array(150 * 3);
    for (let i = 0; i < 150; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 1600;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 1000;
      sPos[i * 3 + 2] = (Math.random() - 0.5) * 600 - 100;
    }
    const sGeo = new THREE.BufferGeometry();
    sGeo.setAttribute("position", new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: new THREE.Color("#F5F0E8"), size: 0.8, transparent: true, opacity: 0.3, sizeAttenuation: false })));

    const onResize = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    let id: number;
    const animate = () => {
      id = requestAnimationFrame(animate);
      const pos = oGeo.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        oData[i].a += oData[i].spd;
        pos.setXYZ(i, Math.cos(oData[i].a) * oData[i].r, oData[i].y, Math.sin(oData[i].a) * oData[i].r);
      }
      pos.needsUpdate = true;
      diskGroup.rotation.z += 0.0007;
      camTarget.x += (mouse.x * 30 - camTarget.x) * 0.04;
      camTarget.y += (mouse.y * 15 - camTarget.y) * 0.04;
      camera.position.x = camTarget.x;
      camera.position.y = 55 + camTarget.y;
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener("mousemove", onMouse);
      window.removeEventListener("resize", onResize);
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
