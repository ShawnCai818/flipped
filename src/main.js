import './style.css'
import * as THREE from 'three';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// --- 1. 场景与渲染设置 ---
const scene = new THREE.Scene();
// 稍微加一点雾效，增加深邃感
scene.fog = new THREE.FogExp2(0x000000, 0.02);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
document.body.appendChild(renderer.domElement);
camera.position.z = 6;

// --- 2. 贴图生成 (保持之前的发光质感) ---
function createGlowTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
    grad.addColorStop(0.2, 'rgba(255, 255, 255, 0.8)');
    grad.addColorStop(0.5, 'rgba(255, 255, 255, 0.2)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 32, 32);
    return new THREE.CanvasTexture(canvas);
}

// --- 3. 莫比乌斯环粒子系统 ---
const particlesGeometry = new THREE.BufferGeometry();
const count = 5000; // 粒子数量

const positions = new Float32Array(count * 3);
const originalPositions = new Float32Array(count * 3);
const colors = new Float32Array(count * 3);
const angles = new Float32Array(count); // 存储每个粒子在环上的角度

// 颜色定义 (青色 <-> 紫色)
const color1 = new THREE.Color(0x00ffff); // 青
const color2 = new THREE.Color(0xff00ff); // 紫

for(let i = 0; i < count; i++) {
    // 莫比乌斯环参数方程
    // u: 环的一圈 (0 -> 2π)
    // v: 环的宽度 (-1 -> 1)
    const u = (i / count) * Math.PI * 2 * 2; // *2 让粒子绕两圈以填满视觉
    const v = (Math.random() - 0.5) * 1.5;   // 环的宽度
    const radius = 2.5; // 环的半径

    // 核心公式
    const x = (radius + v/2 * Math.cos(u/2)) * Math.cos(u);
    const y = (radius + v/2 * Math.cos(u/2)) * Math.sin(u);
    const z = v/2 * Math.sin(u/2);

    // 赋值位置
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;

    // 记住原始位置用于复位
    originalPositions[i * 3] = x;
    originalPositions[i * 3 + 1] = y;
    originalPositions[i * 3 + 2] = z;
    
    angles[i] = u; // 记住角度用于动画

    // 计算渐变色
    const mixedColor = color1.clone().lerp(color2, (Math.sin(u) + 1) / 2);
    colors[i * 3] = mixedColor.r;
    colors[i * 3 + 1] = mixedColor.g;
    colors[i * 3 + 2] = mixedColor.b;
}

particlesGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
particlesGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const material = new THREE.PointsMaterial({
    size: 0.08,
    map: createGlowTexture(),
    transparent: true,
    opacity: 0.8,
    vertexColors: true, // 开启顶点颜色，这样才能显示渐变
    blending: THREE.AdditiveBlending,
    depthWrite: false
});

const particlesMesh = new THREE.Points(particlesGeometry, material);
scene.add(particlesMesh);

// --- 4. AI 初始化 (无需修改) ---
let handLandmarker = undefined;
let video = document.createElement('video');
let lastVideoTime = -1;
let targetX = 0, targetY = 0;
let isHandDetected = false;

async function setupAI() {
    const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
    handLandmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
        },
        runningMode: "VIDEO",
        numHands: 1
    });
    navigator.mediaDevices.getUserMedia({ video: true }).then((stream) => {
        video.srcObject = stream;
        video.addEventListener("loadeddata", predict);
        video.play();
    });
}

// --- 5. 动画循环 (加入独特特效) ---
const clock = new THREE.Clock();

function predict() {
    const time = clock.getElapsedTime();

    // A. 检测手势
    if (handLandmarker && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const result = handLandmarker.detectForVideo(video, performance.now());
        if (result.landmarks && result.landmarks.length > 0) {
            isHandDetected = true;
            const indexTip = result.landmarks[0][8];
            // 映射坐标范围扩大，让手能覆盖整个环
            targetX = (0.5 - indexTip.x) * 10; 
            targetY = (0.5 - indexTip.y) * 8;
        } else {
            isHandDetected = false;
        }
    }

    // B. 粒子物理计算
    const positions = particlesMesh.geometry.attributes.position.array;

    // 让整个环缓慢旋转，展示3D结构
    particlesMesh.rotation.y = time * 0.1;
    particlesMesh.rotation.z = time * 0.05;

    for(let i = 0; i < count; i++) {
        const i3 = i * 3;
        
        // 1. 基础流动：让粒子沿着莫比乌斯环的路径微动
        // 利用之前的角度 u，加上时间偏移，重新计算微小的位置抖动
        const flow = Math.sin(angles[i] + time) * 0.05; 

        // 获取原始位置（带上流动偏移）
        let px = originalPositions[i3] + flow;
        let py = originalPositions[i3 + 1] + flow;
        let pz = originalPositions[i3 + 2];

        if (isHandDetected) {
            // 2. 交互特效：磁力干扰 + 波纹
            // 计算粒子到手指目标的距离
            const dx = targetX - px;
            const dy = targetY - py;
            const dist = Math.sqrt(dx*dx + dy*dy);

            // 只有距离手指比较近的粒子才会被影响 (半径 3.0 以内)
            if (dist < 3.0) {
                // 吸引力：粒子被吸向手指
                const force = (3.0 - dist) * 2.0; // 距离越近，力越大
                
                // 加入一点随机噪点，模拟“滋滋”的电流感
                const noiseX = (Math.random() - 0.5) * 0.1;
                const noiseY = (Math.random() - 0.5) * 0.1;

                px += dx * 0.05 * force + noiseX;
                py += dy * 0.05 * force + noiseY;
                // Z轴产生波浪起伏
                pz += Math.sin(dist * 5 - time * 5) * 0.5; 
            }
        } 
        
        // 3. 平滑更新 (Lerp)
        positions[i3] += (px - positions[i3]) * 0.1;
        positions[i3 + 1] += (py - positions[i3 + 1]) * 0.1;
        positions[i3 + 2] += (pz - positions[i3 + 2]) * 0.1;
    }

    particlesMesh.geometry.attributes.position.needsUpdate = true;
    renderer.render(scene, camera);
    requestAnimationFrame(predict);
}

setupAI();

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
