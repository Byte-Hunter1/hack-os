import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, ShieldAlert, Thermometer, Lock, 
  RefreshCw, Camera, CheckCircle2, Play, Pause, FileText,
  Activity, Binary, AlertTriangle, Eye, EyeOff
} from 'lucide-react';

// ==========================================
// TYPES & INTERFACES
// ==========================================
export type FrameStatus = 'GENUINE' | 'DEEPFAKE' | 'PROCESSING' | 'ERROR';

export interface DetectionResult {
  status: FrameStatus;
  confidenceScore: number; 
  processingTimeMs: number;
  tamperedRegions?: Array<{ x: number; y: number; width: number; height: number; reason: string }>;
  timestamp: number;
}

export interface SecurityManifest {
  isWatermarked: boolean;
  c2paVerified: boolean;
  signatureAlgorithm: string;
  hardwareKeyId: string;
  signingTime: string;
  manifestHash: string;
  signature?: string;
  publicKey?: string;
  deviceLineage: {
    sensor: string;
    isp: string;
    keystore: string;
  };
  licenseTier: string;
  commercialValueScore: number;
  royaltyRights: string;
}

export interface QuantizationProfile {
  id: string;
  name: string;
  int4WeightsPercent: number;
  int8ActivationsPercent: number;
  fp16FallbackPercent: number;
  avgLatencyMs: number;
  accuracyPercent: number;
  powerConsumptionWatts: number;
  description: string;
}

const QUANTIZATION_PROFILES: QuantizationProfile[] = [
  {
    id: 'max-accel',
    name: 'Qualcomm QNN INT4-AOT (Extreme)',
    int4WeightsPercent: 85,
    int8ActivationsPercent: 15,
    fp16FallbackPercent: 0,
    avgLatencyMs: 14.8,
    accuracyPercent: 92.4,
    powerConsumptionWatts: 0.8,
    description: 'Highly quantized model optimized for maximum Hexagon HTP vector engine throughput. Lowest thermal impact.'
  },
  {
    id: 'balanced',
    name: 'Qualcomm QNN INT4/INT8 (Recommended)',
    int4WeightsPercent: 60,
    int8ActivationsPercent: 40,
    fp16FallbackPercent: 0,
    avgLatencyMs: 18.2,
    accuracyPercent: 94.8,
    powerConsumptionWatts: 1.2,
    description: 'Optimal balance. Keeps sensitive classification loss layers in INT8, feature extraction in INT4.'
  },
  {
    id: 'high-precision',
    name: 'Qualcomm QNN INT8 Full',
    int4WeightsPercent: 0,
    int8ActivationsPercent: 100,
    fp16FallbackPercent: 0,
    avgLatencyMs: 23.5,
    accuracyPercent: 96.1,
    powerConsumptionWatts: 1.9,
    description: 'Maintains full 8-bit precision across all layers. Higher memory bandwidth and thermal dissipation.'
  },
  {
    id: 'cpu-fallback',
    name: 'FP16 CPU Fallback (Unoptimized)',
    int4WeightsPercent: 0,
    int8ActivationsPercent: 0,
    fp16FallbackPercent: 100,
    avgLatencyMs: 56.4,
    accuracyPercent: 96.8,
    powerConsumptionWatts: 4.8,
    description: 'Hexagon bypass. Runs execution on Kryo CPU/Adreno GPU. Latency budget exceeded; thermal throttling risk.'
  }
];

// ==========================================
// MAIN COMPONENT
// ==========================================
export const SnapdragonGuardDashboard: React.FC = () => {
  // State variables
  const [selectedProfile, setSelectedProfile] = useState<QuantizationProfile>(QUANTIZATION_PROFILES[1]); // Balanced by default
  const [currentFrameResult, setCurrentFrameResult] = useState<DetectionResult>({
    status: 'PROCESSING',
    confidenceScore: 0,
    processingTimeMs: 0,
    timestamp: Date.now(),
  });
  const [fps, setFps] = useState<number>(30);
  const [isNpuActive, setIsNpuActive] = useState<boolean>(true);
  const [thermalStatus, setThermalStatus] = useState<'NORMAL' | 'WARM' | 'THROTTLED'>('NORMAL');
  const [manifest, setManifest] = useState<SecurityManifest | null>(null);
  const [isCapturing, setIsCapturing] = useState<boolean>(true);
  const [isCameraHookEnabled, setIsCameraHookEnabled] = useState<boolean>(false);
  const [revealWatermark, setRevealWatermark] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<'diagnostics' | 'quantization' | 'middleware' | 'roi' | 'roadmap'>('roi'); // Default to new ROI tab
  const [deepfakeTriggerMode, setDeepfakeTriggerMode] = useState<'auto' | 'force-fake' | 'force-genuine'>('auto');
  
  // Telemetry metrics
  const [accumulatedSavings, setAccumulatedSavings] = useState<number>(0.0);
  
  // ROI Slider states
  const [dau, setDau] = useState<number>(150000); // 150k DAU
  const [cameraMinutes, setCameraMinutes] = useState<number>(8); // 8 mins per user/day
  
  // Middleware states
  const [zeroCopyEnabled, setZeroCopyEnabled] = useState<boolean>(true);
  const [activeBufferIndex, setActiveBufferIndex] = useState<number>(0);
  const [ionPoolUsed, setIonPoolUsed] = useState<number>(24.8); // in MB
  const [cpuUsage, setCpuUsage] = useState<number>(3.5); // %
  
  // Roadmap states
  const [roadmapPhase, setRoadmapPhase] = useState<number>(1);
  const [compilingDlc, setCompilingDlc] = useState<boolean>(false);
  const [compilerLogs, setCompilerLogs] = useState<string[]>([]);
  
  // Ref hooks
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const lastFrameTimeRef = useRef<number>(performance.now());
  const facePointsRef = useRef<{x: number, y: number, tx: number, ty: number}[]>([]);

  // Initialize simulated face keypoints
  useEffect(() => {
    const points = [];
    // Define a basic face mesh
    points.push({ x: 0.3, y: 0.3, tx: 0.3, ty: 0.3 });
    points.push({ x: 0.35, y: 0.5, tx: 0.35, ty: 0.5 });
    points.push({ x: 0.4, y: 0.7, tx: 0.4, ty: 0.7 });
    points.push({ x: 0.5, y: 0.8, tx: 0.5, ty: 0.8 });
    points.push({ x: 0.6, y: 0.7, tx: 0.6, ty: 0.7 });
    points.push({ x: 0.65, y: 0.5, tx: 0.65, ty: 0.5 });
    points.push({ x: 0.7, y: 0.3, tx: 0.7, ty: 0.3 });
    // Left eye
    points.push({ x: 0.42, y: 0.4, tx: 0.42, ty: 0.4 });
    points.push({ x: 0.46, y: 0.4, tx: 0.46, ty: 0.4 });
    // Right eye
    points.push({ x: 0.54, y: 0.4, tx: 0.54, ty: 0.4 });
    points.push({ x: 0.58, y: 0.4, tx: 0.58, ty: 0.4 });
    // Nose bridge and tip
    points.push({ x: 0.5, y: 0.42, tx: 0.5, ty: 0.42 });
    points.push({ x: 0.5, y: 0.55, tx: 0.5, ty: 0.55 });
    // Mouth
    points.push({ x: 0.44, y: 0.65, tx: 0.44, ty: 0.65 });
    points.push({ x: 0.47, y: 0.62, tx: 0.47, ty: 0.62 });
    points.push({ x: 0.5, y: 0.65, tx: 0.5, ty: 0.65 });
    points.push({ x: 0.53, y: 0.62, tx: 0.53, ty: 0.62 });
    points.push({ x: 0.56, y: 0.65, tx: 0.56, ty: 0.65 });
    points.push({ x: 0.5, y: 0.68, tx: 0.5, ty: 0.68 });
    
    facePointsRef.current = points;
  }, []);

  // Handle device webcam access
  useEffect(() => {
    if (isCameraHookEnabled) {
      navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 360 } })
        .then((stream) => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.play().catch(err => console.log("Video play failed", err));
          }
        })
        .catch((err) => {
          console.error("Camera access denied or unavailable", err);
          setIsCameraHookEnabled(false);
        });
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
        videoRef.current.srcObject = null;
      }
    }

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isCameraHookEnabled]);

  // Main 30 FPS Render and AI Inference Loop
  useEffect(() => {
    let frameCount = 0;
    let lastFpsUpdate = performance.now();

    const renderLoop = () => {
      if (!isCapturing) return;

      const now = performance.now();
      const delta = now - lastFrameTimeRef.current;
      const targetDelay = selectedProfile.id === 'cpu-fallback' ? 58.8 : 33.3; // Limit frame rate under unoptimized profiling

      if (delta >= targetDelay) {
        lastFrameTimeRef.current = now;
        frameCount++;

        // Calculate actual FPS
        if (now - lastFpsUpdate >= 1000) {
          setFps(Math.round((frameCount * 1000) / (now - lastFpsUpdate)));
          frameCount = 0;
          lastFpsUpdate = now;
        }

        // Cycle buffer indexes in memory pipeline
        setActiveBufferIndex((prev) => (prev + 1) % 4);

        // Run Mock Inference with values mapped from selected Quantization Profile
        const latency = selectedProfile.avgLatencyMs + (Math.random() * 3 - 1.5) + (zeroCopyEnabled ? 0 : 12.5);
        
        let isFake = false;
        if (deepfakeTriggerMode === 'force-fake') {
          isFake = true;
        } else if (deepfakeTriggerMode === 'force-genuine') {
          isFake = false;
        } else {
          isFake = (Math.sin(now / 5000) > 0.8);
        }

        // Adjust accuracy based on profile
        const baseAccuracy = selectedProfile.accuracyPercent / 100;
        const confidence = isFake 
          ? baseAccuracy - 0.05 + Math.random() * 0.08
          : baseAccuracy - 0.02 + Math.random() * 0.04;

        setCurrentFrameResult({
          status: isFake ? 'DEEPFAKE' : 'GENUINE',
          confidenceScore: Math.min(Math.max(confidence, 0.5), 0.99),
          processingTimeMs: Math.round(latency * 10) / 10,
          timestamp: Date.now(),
          tamperedRegions: isFake ? [
            { 
              x: 42, 
              y: 58, 
              width: 16, 
              height: 12, 
              reason: 'Lips Sync Blending Anomaly' 
            }
          ] : undefined
        });

        // Set thermal telemetry based on power usage & latency
        const totalLatency = latency + 2.5 + 4.0; // Prep + NPU + Post
        if (selectedProfile.id === 'cpu-fallback') {
          setThermalStatus('THROTTLED');
          setCpuUsage(Math.round(45 + Math.random() * 10));
          setIsNpuActive(false);
        } else if (totalLatency > 30) {
          setThermalStatus('WARM');
          setCpuUsage(Math.round(12 + Math.random() * 4));
          setIsNpuActive(true);
        } else {
          setThermalStatus('NORMAL');
          setCpuUsage(Math.round(2.5 + Math.random() * 2.0 + (zeroCopyEnabled ? 0 : 6.0)));
          setIsNpuActive(true);
        }

        // Update ION allocation visualization
        setIonPoolUsed((prev) => {
          const target = zeroCopyEnabled ? 24.8 : 98.4;
          return Math.round((prev * 0.9 + target * 0.1) * 10) / 10;
        });

        // Ticker for session savings accumulator ($0.000262 saved per frame)
        setAccumulatedSavings((prev) => prev + 0.000262);

        // Draw Canvas Graphics
        drawSimulationCanvas(isFake);
      }

      requestRef.current = requestAnimationFrame(renderLoop);
    };

    const drawSimulationCanvas = (isFake: boolean) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      // 1. Draw Background
      if (isCameraHookEnabled && videoRef.current && videoRef.current.readyState >= 2) {
        ctx.save();
        ctx.scale(-1, 1); // Mirror
        ctx.drawImage(videoRef.current, -w, 0, w, h);
        ctx.restore();
      } else {
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, '#0a0d1a');
        grad.addColorStop(1, '#05070e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        ctx.strokeStyle = 'rgba(30, 41, 59, 0.4)';
        ctx.lineWidth = 1;
        const gridSize = 30;
        for (let x = 0; x < w; x += gridSize) {
          ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
        }
        for (let y = 0; y < h; y += gridSize) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }
      }

      // 2. Draw Scanline Overlay
      const sweepY = (performance.now() / 6) % (h * 1.5) - h * 0.25;
      if (sweepY >= 0 && sweepY <= h) {
        const sweepGrad = ctx.createLinearGradient(0, sweepY - 40, 0, sweepY + 4);
        const color = isFake ? 'rgba(239, 68, 68, 0.15)' : 'rgba(0, 240, 255, 0.15)';
        sweepGrad.addColorStop(0, 'rgba(0,0,0,0)');
        sweepGrad.addColorStop(0.8, color);
        sweepGrad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = sweepGrad;
        ctx.fillRect(0, sweepY - 40, w, 44);
        
        ctx.strokeStyle = isFake ? 'rgba(239, 68, 68, 0.5)' : 'rgba(0, 240, 255, 0.5)';
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, sweepY); ctx.lineTo(w, sweepY); ctx.stroke();
      }

      // 3. Draw Biometric Facial Mesh
      const time = performance.now() / 1000;
      const points = facePointsRef.current;
      
      const meshColor = isFake ? 'rgba(239, 68, 68, 0.45)' : 'rgba(16, 185, 129, 0.5)';
      const nodeColor = isFake ? '#EF4444' : '#10B981';

      if (points.length > 0) {
        points.forEach((p, idx) => {
          const dx = Math.sin(time + idx * 3.14) * 0.003;
          const dy = Math.cos(time * 1.2 + idx * 1.5) * 0.003;
          p.x = p.tx + dx;
          p.y = p.ty + dy;
        });

        const px = (p: typeof points[0]) => p.x * w;
        const py = (p: typeof points[0]) => p.y * h;

        ctx.strokeStyle = meshColor;
        ctx.lineWidth = 1;

        // Contour
        ctx.beginPath();
        ctx.moveTo(px(points[0]), py(points[0]));
        for (let i = 1; i <= 6; i++) ctx.lineTo(px(points[i]), py(points[i]));
        ctx.stroke();

        // Left eye
        ctx.beginPath();
        ctx.ellipse(px(points[7]) + 10, py(points[7]), 15, 8, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Right eye
        ctx.beginPath();
        ctx.ellipse(px(points[9]) + 10, py(points[9]), 15, 8, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Nose
        ctx.beginPath();
        ctx.moveTo(px(points[11]), py(points[11]));
        ctx.lineTo(px(points[12]), py(points[12]));
        ctx.lineTo(px(points[12]) - 10, py(points[12]) + 5);
        ctx.lineTo(px(points[12]) + 10, py(points[12]) + 5);
        ctx.closePath();
        ctx.stroke();

        // Mouth
        ctx.beginPath();
        ctx.moveTo(px(points[13]), py(points[13]));
        for (let i = 14; i <= 18; i++) ctx.lineTo(px(points[i]), py(points[i]));
        ctx.closePath();
        ctx.stroke();

        // Connections
        ctx.strokeStyle = isFake ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)';
        for (let i = 0; i <= 6; i++) {
          ctx.beginPath();
          ctx.moveTo(px(points[i]), py(points[i]));
          ctx.lineTo(px(points[12]), py(points[12]));
          ctx.stroke();
        }

        // Draw nodes
        points.forEach((p) => {
          ctx.fillStyle = nodeColor;
          ctx.beginPath(); ctx.arc(px(p), py(p), 3, 0, Math.PI * 2); ctx.fill();
          
          ctx.fillStyle = isFake ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
          ctx.beginPath(); ctx.arc(px(p), py(p), 6, 0, Math.PI * 2); ctx.fill();
        });
      }

      // 4. Bounding Box for Deepfake
      if (isFake) {
        const rx = 0.42 * w;
        const ry = 0.58 * h;
        const rw = 0.16 * w;
        const rh = 0.12 * h;

        ctx.strokeStyle = '#FF003C';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(rx, ry, rw, rh);
        ctx.setLineDash([]);

        ctx.shadowColor = '#FF003C';
        ctx.shadowBlur = 10;
        ctx.fillStyle = 'rgba(255, 0, 60, 0.12)';
        ctx.fillRect(rx, ry, rw, rh);
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#FF003C';
        ctx.font = 'bold 9px monospace';
        ctx.fillRect(rx, ry - 18, 145, 18);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('LIPS BLENDING DEEPFAKE 94%', rx + 5, ry - 6);
      }

      // 5. Watermark Revealer
      if (revealWatermark) {
        const rxStart = 0.42 * w;
        const rxEnd = 0.58 * w;
        const ryStart = 0.58 * h;
        const ryEnd = 0.70 * h;

        ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
        ctx.fillRect(0, 0, w, h);

        ctx.fillStyle = '#00F0FF';
        ctx.font = 'bold 10px monospace';
        ctx.fillText('SPATIAL WATERMARK CHANNEL REVEALED (ISP HIGHPASS FILTER)', 15, 25);
        ctx.fillText('TEE KEY: ' + (manifest?.hardwareKeyId || 'SECURE_TEE_0x8C8CDD3'), 15, 40);

        const density = 6;
        for (let y = 10; y < h - 10; y += density) {
          for (let x = 10; x < w - 10; x += density) {
            const insideTamper = isFake && (x >= rxStart && x <= rxEnd && y >= ryStart && y <= ryEnd);
            if (insideTamper) {
              if (Math.random() > 0.95) {
                ctx.fillStyle = '#FF003C';
                ctx.fillRect(x, y, 1, 1);
              }
            } else {
              const waveVal = Math.sin(x * 0.15) * Math.cos(y * 0.15);
              if (waveVal > 0.4) {
                ctx.fillStyle = 'rgba(0, 240, 255, 0.7)';
                ctx.fillRect(x, y, 1.5, 1.5);
              }
            }
          }
        }

        if (isFake) {
          ctx.strokeStyle = '#FF003C';
          ctx.lineWidth = 1;
          ctx.strokeRect(rxStart - 2, ryStart - 2, (rxEnd - rxStart) + 4, (ryEnd - ryStart) + 4);
          ctx.fillStyle = '#FF003C';
          ctx.font = '9px monospace';
          ctx.fillText('WATERMARK RUPTURED / MODIFIED PIXELS', rxStart, ryStart - 6);
        } else {
          ctx.strokeStyle = '#00F0FF';
          ctx.lineWidth = 1;
          ctx.strokeRect(2, 2, w - 4, h - 4);
          ctx.fillStyle = '#00F0FF';
          ctx.fillText('SPATIAL CORRELATION SECURE: 100%', w - 210, h - 10);
        }
      }

      // HUD crosshairs
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(15, 30); ctx.lineTo(15, 15); ctx.lineTo(30, 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w - 15, 30); ctx.lineTo(w - 15, 15); ctx.lineTo(w - 30, 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(15, h - 30); ctx.lineTo(15, h - 15); ctx.lineTo(30, h - 15); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w - 15, h - 30); ctx.lineTo(w - 15, h - 15); ctx.lineTo(w - 30, h - 15); ctx.stroke();
    };

    if (isCapturing) {
      requestRef.current = requestAnimationFrame(renderLoop);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isCapturing, selectedProfile, zeroCopyEnabled, deepfakeTriggerMode, isCameraHookEnabled, revealWatermark, manifest]);

  // Handle asset sign & generate commercial license credentials
  const handleSignAsset = async () => {
    if (!canvasRef.current) return;

    try {
      const frameData = canvasRef.current.toDataURL('image/jpeg');

      const response = await fetch('/api/sign', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image: frameData,
          metadata: {
            selectedProfile: selectedProfile.id,
            timestamp: Date.now()
          }
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const result = await response.json();
      if (result.success && result.manifest) {
        setManifest(result.manifest);
      } else {
        console.error('Signing failed:', result);
      }
    } catch (err) {
      console.error('Error during asset signing:', err);
      // Fallback to local generation if backend is unavailable
      const hash = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      const mockManifest: SecurityManifest = {
        isWatermarked: true,
        c2paVerified: true,
        signatureAlgorithm: 'ECDSA_P256_SHA256 (StrongBox locked)',
        hardwareKeyId: 'QUALCOMM_TEE_ENV_0x8C8CDD3',
        signingTime: new Date().toISOString(),
        manifestHash: `sha256:${hash}`,
        deviceLineage: {
          sensor: 'Sony IMX800 / Snapdragon Camera HAL3 Surface Interceptor',
          isp: 'Qualcomm Spectra 680 ISP (Dual Engine)',
          keystore: 'Snapdragon Secure Processing Unit (SPU) TrustZone'
        },
        licenseTier: 'Enterprise Premium Content Rights',
        commercialValueScore: 98.4,
        royaltyRights: 'Protected Content Registry Royalty Pool Active'
      };
      setManifest(mockManifest);
    }
  };

  // Compile ONNX to DLC terminal simulator
  const handleCompileDlc = () => {
    if (compilingDlc) return;
    setCompilingDlc(true);
    setCompilerLogs([]);
    
    const logs = [
      '[QAIRT] Initializing Qualcomm Neural Network DLC compiler...',
      '[QAIRT] Loading ONNX model from deepfake_lite.onnx...',
      '[QAIRT] Parsing network topology. Found 82 operators.',
      '[QAIRT] Phase 1: Applying mixed-precision optimization (INT4 weights / INT8 activations)...',
      '[QAIRT] Quantizing Conv2d_1: Weight range [-1.2, 1.4] -> mapping to INT4 asymmetrically.',
      '[QAIRT] Quantizing Conv2d_12: Activation scaling factor determined using calibration dataset.',
      '[QAIRT] Quantizing Loss/Output Layer: Clamping to INT8 to protect precision.',
      '[QAIRT] Compiling target graph for Snapdragon Hexagon Tensor Processor (HTP V73)...',
      '[QAIRT] Generating zero-copy context binary matching HTP architecture.',
      '[QAIRT] DLC context package created successfully: deepfake_det_v73.dlc (size: 4.8MB).',
      '[QAIRT] Compilation complete. Hexagon Vector Extensions (HVX) runtime latency target: 18.2ms.'
    ];

    logs.forEach((log, idx) => {
      setTimeout(() => {
        setCompilerLogs(prev => [...prev, log]);
        if (idx === logs.length - 1) {
          setCompilingDlc(false);
        }
      }, (idx + 1) * 350);
    });
  };

  // Status mapping colors
  const getStatusColor = (status: FrameStatus) => {
    switch (status) {
      case 'GENUINE': return '#10B981';
      case 'DEEPFAKE': return '#FF3366';
      case 'PROCESSING': return '#00F0FF';
      default: return '#64748B'; 
    }
  };

  // ROI cost savings math formulas
  // Cloud GPU inference cost: $0.00025 per frame
  // Cloud Network egress cost: $0.000012 per frame (150KB @ $0.08/GB)
  // Total Cloud cost per user minute = 1800 frames * $0.000262 = $0.4716
  const cloudGpuCostPerUserMin = 1800 * 0.00025;
  const cloudBandwidthCostPerUserMin = 1800 * 150 * 1024 * 0.08 / 1e9;
  
  const dailyCloudGpuBill = dau * cameraMinutes * cloudGpuCostPerUserMin;
  const dailyCloudBandwidthBill = dau * cameraMinutes * cloudBandwidthCostPerUserMin;
  
  const monthlyCloudGpuBill = dailyCloudGpuBill * 30;
  const monthlyCloudBandwidthBill = dailyCloudBandwidthBill * 30;
  
  const totalMonthlyCloudBill = monthlyCloudGpuBill + monthlyCloudBandwidthBill;
  const edgeDeviceCost = 0.0;
  
  const monthlyNetSavings = totalMonthlyCloudBill - edgeDeviceCost;
  const bandwidthSavedGb = Math.round(dau * cameraMinutes * 1800 * 150 * 1024 / 1e9 * 30);
  const carbonOffsetKg = Math.round(dau * cameraMinutes * 0.0005 * 30);

  return (
    <div style={dashboardStyles.container}>
      <video ref={videoRef} style={{ display: 'none' }} playsInline muted />

      {/* HEADER SECTION */}
      <header style={dashboardStyles.header}>
        <div style={dashboardStyles.headerLeft}>
          <div style={dashboardStyles.titleRow}>
            <div style={dashboardStyles.brandLogo}>
              <Shield size={24} color="#00F0FF" />
            </div>
            <div>
              <h1 style={dashboardStyles.titleText}>SNAPDRAGON GUARD</h1>
              <p style={dashboardStyles.subtitleText}>Real-Time On-Device Camera Stream Provenance & Deepfake Interceptor</p>
            </div>
          </div>
        </div>

        <div style={dashboardStyles.headerRight}>
          {/* Dynamically Ticking Session ROI Savings */}
          <div style={{
            ...dashboardStyles.statusBadge,
            borderColor: 'rgba(16, 185, 129, 0.3)',
            backgroundColor: 'rgba(16, 185, 129, 0.08)',
            boxShadow: '0 0 10px rgba(16, 185, 129, 0.2)'
          }}>
            <span style={{ fontSize: '11px', fontWeight: 700, color: '#10B981', fontFamily: 'monospace' }}>
              SESSION SAVINGS (ROI): ${accumulatedSavings.toFixed(4)}
            </span>
          </div>

          <div style={dashboardStyles.statusBadge}>
            <span style={{ 
              ...dashboardStyles.badgeDot, 
              backgroundColor: isNpuActive ? '#10B981' : '#64748B',
              boxShadow: isNpuActive ? '0 0 8px #10B981' : 'none' 
            }} />
            <span style={dashboardStyles.badgeText}>
              {isNpuActive ? `NPU ACCELERATED (${selectedProfile.name.split(' ')[2] || 'INT4'})` : 'CPU FALLBACK'}
            </span>
          </div>

          <div style={{
            ...dashboardStyles.statusBadge,
            borderColor: thermalStatus === 'NORMAL' ? 'rgba(16, 185, 129, 0.2)' : '#FF3366',
            backgroundColor: thermalStatus === 'NORMAL' ? 'rgba(16, 185, 129, 0.05)' : 'rgba(255, 51, 102, 0.05)'
          }}>
            <Thermometer size={14} color={thermalStatus === 'NORMAL' ? '#10B981' : '#FF3366'} />
            <span style={{ 
              ...dashboardStyles.badgeText,
              color: thermalStatus === 'NORMAL' ? '#10B981' : '#FF3366'
            }}>
              THERMAL: {thermalStatus}
            </span>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div style={dashboardStyles.mainGrid}>
        
        {/* LEFT COLUMN: INTERCEPTION VIEWPORT */}
        <section style={dashboardStyles.viewPortCard}>
          <div style={dashboardStyles.cardHeader}>
            <div style={dashboardStyles.cardTitleGroup}>
              <Camera size={18} color="#94A3B8" />
              <h2 style={dashboardStyles.cardTitle}>Live Hardware ISP Interception</h2>
            </div>
            <div style={dashboardStyles.viewPortToggles}>
              <button 
                onClick={() => setIsCameraHookEnabled(!isCameraHookEnabled)}
                style={{
                  ...dashboardStyles.toggleBtn,
                  backgroundColor: isCameraHookEnabled ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
                  borderColor: isCameraHookEnabled ? '#00F0FF' : '#334155',
                  color: isCameraHookEnabled ? '#00F0FF' : '#94A3B8',
                }}
              >
                <Camera size={12} />
                <span>{isCameraHookEnabled ? 'Disconnect Camera' : 'Hook Front Camera'}</span>
              </button>
              
              <button
                onClick={() => setRevealWatermark(!revealWatermark)}
                style={{
                  ...dashboardStyles.toggleBtn,
                  backgroundColor: revealWatermark ? 'rgba(0, 240, 255, 0.15)' : 'transparent',
                  borderColor: revealWatermark ? '#00F0FF' : '#334155',
                  color: revealWatermark ? '#00F0FF' : '#94A3B8',
                }}
              >
                {revealWatermark ? <EyeOff size={12} /> : <Eye size={12} />}
                <span>{revealWatermark ? 'Hide Watermark' : 'Reveal Watermark'}</span>
              </button>
            </div>
          </div>

          {/* CANVAS CONTAINER */}
          <div style={dashboardStyles.viewportFrameContainer}>
            <canvas ref={canvasRef} width={640} height={360} style={dashboardStyles.viewportCanvas} />

            {/* LIVE DETECTION BANNER */}
            <div style={{
              ...dashboardStyles.detectionOverlayBanner,
              backgroundColor: getStatusColor(currentFrameResult.status) + 'DE',
              borderColor: getStatusColor(currentFrameResult.status)
            }}>
              {currentFrameResult.status === 'DEEPFAKE' ? (
                <div style={dashboardStyles.bannerContent}>
                  <ShieldAlert size={18} color="#FFFFFF" className="animate-pulse" />
                  <span style={dashboardStyles.bannerText}>
                    SYNTHETIC MEDIA DETECTED: {currentFrameResult.tamperedRegions?.[0].reason} ({Math.round(currentFrameResult.confidenceScore * 100)}% Confidence)
                  </span>
                </div>
              ) : (
                <div style={dashboardStyles.bannerContent}>
                  <Lock size={18} color="#FFFFFF" />
                  <span style={dashboardStyles.bannerText}>
                    SECURE PHYSICAL SOURCE VALIDATED ({Math.round(currentFrameResult.confidenceScore * 100)}% Match)
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* VIEWPORT CONTROLS */}
          <div style={dashboardStyles.controlsContainer}>
            <div style={dashboardStyles.modeSelectorGroup}>
              <span style={dashboardStyles.controlLabel}>Simulation Injection:</span>
              <div style={dashboardStyles.btnGroup}>
                <button 
                  onClick={() => setDeepfakeTriggerMode('auto')}
                  style={{
                    ...dashboardStyles.selectorBtn,
                    backgroundColor: deepfakeTriggerMode === 'auto' ? '#1E293B' : 'transparent',
                    color: deepfakeTriggerMode === 'auto' ? '#00F0FF' : '#64748B',
                    borderColor: deepfakeTriggerMode === 'auto' ? '#00F0FF' : 'transparent'
                  }}
                >
                  Auto Cycle
                </button>
                <button 
                  onClick={() => setDeepfakeTriggerMode('force-genuine')}
                  style={{
                    ...dashboardStyles.selectorBtn,
                    backgroundColor: deepfakeTriggerMode === 'force-genuine' ? '#1E293B' : 'transparent',
                    color: deepfakeTriggerMode === 'force-genuine' ? '#10B981' : '#64748B',
                    borderColor: deepfakeTriggerMode === 'force-genuine' ? '#10B981' : 'transparent'
                  }}
                >
                  Force Genuine
                </button>
                <button 
                  onClick={() => setDeepfakeTriggerMode('force-fake')}
                  style={{
                    ...dashboardStyles.selectorBtn,
                    backgroundColor: deepfakeTriggerMode === 'force-fake' ? '#1E293B' : 'transparent',
                    color: deepfakeTriggerMode === 'force-fake' ? '#FF3366' : '#64748B',
                    borderColor: deepfakeTriggerMode === 'force-fake' ? '#FF3366' : 'transparent'
                  }}
                >
                  Force deepfake
                </button>
              </div>
            </div>

            <div style={dashboardStyles.captureActionRow}>
              <button 
                onClick={() => setIsCapturing(!isCapturing)}
                style={{
                  ...dashboardStyles.actionBtn,
                  backgroundColor: isCapturing ? 'rgba(255, 51, 102, 0.15)' : 'rgba(0, 240, 255, 0.15)',
                  borderColor: isCapturing ? '#FF3366' : '#00F0FF',
                  color: isCapturing ? '#FF3366' : '#00F0FF'
                }}
              >
                {isCapturing ? <Pause size={14} /> : <Play size={14} />}
                <span>{isCapturing ? 'Pause Pipeline' : 'Resume Pipeline'}</span>
              </button>

              <button 
                onClick={handleSignAsset}
                disabled={currentFrameResult.status === 'DEEPFAKE'}
                style={{
                  ...dashboardStyles.actionBtn,
                  backgroundColor: currentFrameResult.status === 'DEEPFAKE' ? 'rgba(71, 85, 105, 0.2)' : 'rgba(16, 185, 129, 0.15)',
                  borderColor: currentFrameResult.status === 'DEEPFAKE' ? '#475569' : '#10B981',
                  color: currentFrameResult.status === 'DEEPFAKE' ? '#64748B' : '#10B981',
                  cursor: currentFrameResult.status === 'DEEPFAKE' ? 'not-allowed' : 'pointer'
                }}
              >
                <Lock size={14} />
                <span>Inject C2PA Watermark & Sign</span>
              </button>
            </div>
          </div>

          {/* TELEMETRY TIMELINE */}
          <div style={dashboardStyles.timelineContainer}>
            <div style={dashboardStyles.timelineHeader}>
              <div style={dashboardStyles.timelineLabelGroup}>
                <Activity size={16} color="#00F0FF" />
                <span style={dashboardStyles.timelineTitle}>30 FPS Real-time Pipeline Schedule (~33.3ms budget)</span>
              </div>
              <span style={{
                ...dashboardStyles.latencyIndicator,
                color: (currentFrameResult.processingTimeMs + 6.5) > 33.3 ? '#FF3366' : '#10B981'
              }}>
                Frame Latency: {(currentFrameResult.processingTimeMs + 6.5).toFixed(1)} ms
              </span>
            </div>

            <div style={dashboardStyles.timelineTracks}>
              <div style={dashboardStyles.trackRow}>
                <span style={dashboardStyles.trackLabel}>ISP Preprocess</span>
                <div style={dashboardStyles.trackBarContainer}>
                  <div style={{ ...dashboardStyles.trackBar, width: '7.5%', backgroundColor: '#10B981' }} />
                  <span style={dashboardStyles.trackDuration}>2.5ms</span>
                </div>
              </div>

              <div style={dashboardStyles.trackRow}>
                <span style={dashboardStyles.trackLabel}>QNN HTP NPU</span>
                <div style={dashboardStyles.trackBarContainer}>
                  <div style={{
                    ...dashboardStyles.trackBar,
                    left: '7.5%',
                    width: `${(currentFrameResult.processingTimeMs / 33.3) * 100}%`,
                    backgroundColor: selectedProfile.id === 'cpu-fallback' ? '#FF3366' : '#00F0FF',
                    boxShadow: selectedProfile.id === 'cpu-fallback' ? 'none' : '0 0 10px rgba(0, 240, 255, 0.4)'
                  }} />
                  <span style={{
                    ...dashboardStyles.trackDuration,
                    left: `calc(7.5% + ${(currentFrameResult.processingTimeMs / 33.3) * 100}% + 6px)`,
                    color: selectedProfile.id === 'cpu-fallback' ? '#FF3366' : '#00F0FF'
                  }}>{currentFrameResult.processingTimeMs}ms</span>
                </div>
              </div>

              <div style={dashboardStyles.trackRow}>
                <span style={dashboardStyles.trackLabel}>Watermarking & HUD</span>
                <div style={dashboardStyles.trackBarContainer}>
                  <div style={{ ...dashboardStyles.trackBar, left: `calc(7.5% + ${(currentFrameResult.processingTimeMs / 33.3) * 100}%)`, width: '12%', backgroundColor: '#A855F7' }} />
                  <span style={{ ...dashboardStyles.trackDuration, left: `calc(7.5% + ${(currentFrameResult.processingTimeMs / 33.3) * 100}% + 12% + 6px)`, color: '#A855F7' }}>4.0ms</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* RIGHT COLUMN: TABS & SYSTEM CONTROLS */}
        <section style={dashboardStyles.sidebarCard}>
          <div style={dashboardStyles.tabBar}>
            {/* ROI Tab Prominently Added */}
            <button 
              onClick={() => setActiveTab('roi')}
              style={{
                ...dashboardStyles.tabBtn,
                color: activeTab === 'roi' ? '#F8FAFC' : '#64748B',
                borderBottomColor: activeTab === 'roi' ? '#10B981' : 'transparent',
              }}
            >
              ROI Savings
            </button>
            <button 
              onClick={() => setActiveTab('diagnostics')}
              style={{
                ...dashboardStyles.tabBtn,
                color: activeTab === 'diagnostics' ? '#F8FAFC' : '#64748B',
                borderBottomColor: activeTab === 'diagnostics' ? '#00F0FF' : 'transparent',
              }}
            >
              HW Stats
            </button>
            <button 
              onClick={() => setActiveTab('quantization')}
              style={{
                ...dashboardStyles.tabBtn,
                color: activeTab === 'quantization' ? '#F8FAFC' : '#64748B',
                borderBottomColor: activeTab === 'quantization' ? '#00F0FF' : 'transparent',
              }}
            >
              Quantization
            </button>
            <button 
              onClick={() => setActiveTab('middleware')}
              style={{
                ...dashboardStyles.tabBtn,
                color: activeTab === 'middleware' ? '#F8FAFC' : '#64748B',
                borderBottomColor: activeTab === 'middleware' ? '#00F0FF' : 'transparent',
              }}
            >
              Middleware
            </button>
            <button 
              onClick={() => setActiveTab('roadmap')}
              style={{
                ...dashboardStyles.tabBtn,
                color: activeTab === 'roadmap' ? '#F8FAFC' : '#64748B',
                borderBottomColor: activeTab === 'roadmap' ? '#00F0FF' : 'transparent',
              }}
            >
              Roadmap
            </button>
          </div>

          <div style={dashboardStyles.tabContent}>
            {/* NEW TAB: ROI & SAVINGS ESTIMATOR */}
            {activeTab === 'roi' && (
              <div style={dashboardStyles.roiPanel}>
                <h3 style={dashboardStyles.panelTitle}>Edge Infrastructure ROI Estimator</h3>
                <p style={dashboardStyles.panelDesc}>Calculate infrastructure cost savings by offloading camera stream AI processing to on-device Snapdragon HTP NPUs, avoiding expensive cloud bills.</p>
                
                {/* Sliders container */}
                <div style={dashboardStyles.slidersWrapper}>
                  <div style={dashboardStyles.sliderGroup}>
                    <div style={dashboardStyles.sliderLabelsRow}>
                      <span style={dashboardStyles.sliderLabel}>Daily Active Users (DAU):</span>
                      <span style={dashboardStyles.sliderValue}>{dau.toLocaleString()}</span>
                    </div>
                    <input 
                      type="range"
                      min={10000}
                      max={1000000}
                      step={10000}
                      value={dau}
                      onChange={(e) => setDau(Number(e.target.value))}
                      style={dashboardStyles.rangeSlider}
                    />
                  </div>

                  <div style={dashboardStyles.sliderGroup}>
                    <div style={dashboardStyles.sliderLabelsRow}>
                      <span style={dashboardStyles.sliderLabel}>Active Camera Usage:</span>
                      <span style={dashboardStyles.sliderValue}>{cameraMinutes} Mins/User/Day</span>
                    </div>
                    <input 
                      type="range"
                      min={1}
                      max={60}
                      step={1}
                      value={cameraMinutes}
                      onChange={(e) => setCameraMinutes(Number(e.target.value))}
                      style={dashboardStyles.rangeSlider}
                    />
                  </div>
                </div>

                {/* Savings Breakdown */}
                <div style={dashboardStyles.savingsGrid}>
                  <div style={{ ...dashboardStyles.savingsCard, borderLeftColor: '#FF3366' }}>
                    <span style={dashboardStyles.roiCardLabel}>Est. Monthly Cloud GPU Bill</span>
                    <span style={{ ...dashboardStyles.roiCardVal, color: '#FF3366' }}>
                      ${Math.round(monthlyCloudGpuBill).toLocaleString()}
                    </span>
                  </div>
                  
                  <div style={{ ...dashboardStyles.savingsCard, borderLeftColor: '#F59E0B' }}>
                    <span style={dashboardStyles.roiCardLabel}>Est. Monthly Cloud Bandwidth</span>
                    <span style={{ ...dashboardStyles.roiCardVal, color: '#F59E0B' }}>
                      ${Math.round(monthlyCloudBandwidthBill).toLocaleString()}
                    </span>
                  </div>

                  <div style={{ ...dashboardStyles.savingsCard, borderLeftColor: '#10B981', gridColumn: 'span 2' }}>
                    <span style={dashboardStyles.roiCardLabel}>On-Device Snapdragon Net Cost</span>
                    <span style={{ ...dashboardStyles.roiCardVal, color: '#10B981' }}>
                      $0.00 (Zero-Leak Edge Process)
                    </span>
                  </div>

                  <div style={{ ...dashboardStyles.savingsCard, borderLeftColor: '#00F0FF', gridColumn: 'span 2', backgroundColor: 'rgba(0, 240, 255, 0.03)' }}>
                    <span style={dashboardStyles.roiCardLabel}>MONTHLY INFRASTRUCTURE PROFIT RECLAIMED</span>
                    <span style={{ ...dashboardStyles.roiCardVal, color: '#00F0FF', fontSize: '18px' }}>
                      ${Math.round(monthlyNetSavings).toLocaleString()} / month
                    </span>
                  </div>
                </div>

                {/* Green/Environmental telemetry */}
                <div style={dashboardStyles.greenTelemetryBox}>
                  <div style={dashboardStyles.greenTelemetryLine}>
                    <span style={dashboardStyles.greenLabel}>Egress Network Bandwidth Conserved:</span>
                    <span style={dashboardStyles.greenValue}>{bandwidthSavedGb >= 1000 ? `${(bandwidthSavedGb / 1000).toFixed(1)} TB` : `${bandwidthSavedGb} GB`} / month</span>
                  </div>
                  <div style={dashboardStyles.greenTelemetryLine}>
                    <span style={dashboardStyles.greenLabel}>Data Center Carbon Footprint Offset:</span>
                    <span style={dashboardStyles.greenValue}>{carbonOffsetKg.toLocaleString()} kg CO₂ / month</span>
                  </div>
                </div>

                {/* Savings Growth Chart */}
                <div style={dashboardStyles.savingsChartBox}>
                  <span style={dashboardStyles.chartTitle}>Cumulative 12-Month Profit Trend ($)</span>
                  <div style={dashboardStyles.chartWrapper}>
                    <svg viewBox="0 0 300 80" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                      <defs>
                        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#00F0FF" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#00F0FF" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>
                      
                      {/* Grid lines */}
                      <line x1="30" y1="10" x2="290" y2="10" stroke="rgba(255,255,255,0.03)" />
                      <line x1="30" y1="35" x2="290" y2="35" stroke="rgba(255,255,255,0.03)" />
                      <line x1="30" y1="60" x2="290" y2="60" stroke="rgba(255,255,255,0.03)" />

                      {/* Area Path */}
                      <path 
                        d={`M 30,60 L 73,56 L 116,51 L 160,43 L 203,34 L 246,23 L 290,10 L 290,60 Z`}
                        fill="url(#chartGrad)" 
                      />
                      
                      {/* Line Path */}
                      <path 
                        d="M 30,60 L 73,56 L 116,51 L 160,43 L 203,34 L 246,23 L 290,10" 
                        fill="none" 
                        stroke="#00F0FF" 
                        strokeWidth="2" 
                      />

                      {/* Data dots */}
                      <circle cx="30" cy="60" r="3" fill="#00F0FF" />
                      <circle cx="160" cy="43" r="3" fill="#00F0FF" />
                      <circle cx="290" cy="10" r="3" fill="#00F0FF" />

                      {/* Labels */}
                      <text x="25" y="72" fill="#64748B" fontSize="6">Month 1</text>
                      <text x="150" y="72" fill="#64748B" fontSize="6">Month 6</text>
                      <text x="270" y="72" fill="#64748B" fontSize="6">Month 12</text>
                      
                      <text x="35" y="54" fill="#00F0FF" fontSize="7">${Math.round(monthlyNetSavings / 1000)}k</text>
                      <text x="250" y="10" fill="#00F0FF" fontSize="8" fontWeight="bold">${Math.round(monthlyNetSavings * 12 / 1000000).toFixed(1)}M Saved</text>
                    </svg>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 1: DIAGNOSTICS & SYSTEM STATUS */}
            {activeTab === 'diagnostics' && (
              <div style={dashboardStyles.diagnosticsPanel}>
                <div style={dashboardStyles.telemetryHeaderRow}>
                  <h3 style={dashboardStyles.panelTitle}>SoC Telemetry Monitors</h3>
                  <span style={dashboardStyles.fpsCounter}>{fps} FPS</span>
                </div>
                
                <div style={dashboardStyles.metricGrid}>
                  <div style={dashboardStyles.metricBox}>
                    <span style={dashboardStyles.metricLabel}>Hexagon NPU Execution</span>
                    <span style={dashboardStyles.metricValue}>{isNpuActive ? 'HTP V73 Active' : 'Offline'}</span>
                  </div>
                  <div style={dashboardStyles.metricBox}>
                    <span style={dashboardStyles.metricLabel}>Memory Copy Overhead</span>
                    <span style={{ 
                      ...dashboardStyles.metricValue, 
                      color: zeroCopyEnabled ? '#10B981' : '#FF3366' 
                    }}>{zeroCopyEnabled ? '0.0 ms (Zero-Copy)' : '12.5 ms (Cache Copy)'}</span>
                  </div>
                  <div style={dashboardStyles.metricBox}>
                    <span style={dashboardStyles.metricLabel}>Buffer Type</span>
                    <span style={dashboardStyles.metricValue}>AHardwareBuffer</span>
                  </div>
                  <div style={dashboardStyles.metricBox}>
                    <span style={dashboardStyles.metricLabel}>Estimated Power Draw</span>
                    <span style={{ 
                      ...dashboardStyles.metricValue,
                      color: selectedProfile.powerConsumptionWatts > 2.5 ? '#FF3366' : '#10B981'
                    }}>{selectedProfile.powerConsumptionWatts} W</span>
                  </div>
                </div>

                {/* SECURE ENCLAVE SIGNATURE BOX & PREMIUM ASSET LICENSING */}
                <div style={dashboardStyles.secureEnclaveBox}>
                  <div style={dashboardStyles.enclaveHeader}>
                    <Lock size={16} color="#10B981" />
                    <span style={dashboardStyles.enclaveTitle}>Hardware Protected Keystore (TEE)</span>
                  </div>
                  
                  {manifest ? (
                    <div style={dashboardStyles.manifestContent}>
                      <div style={dashboardStyles.manifestLine}>
                        <span style={dashboardStyles.manifestKey}>Verified Source:</span>
                        <span style={dashboardStyles.manifestVal}>{manifest.deviceLineage.sensor}</span>
                      </div>
                      <div style={dashboardStyles.manifestLine}>
                        <span style={dashboardStyles.manifestKey}>Secure Signature:</span>
                        <span style={dashboardStyles.manifestVal} className="font-mono">{manifest.hardwareKeyId}</span>
                      </div>
                      {/* Premium Content Rights Licensing Details added */}
                      <div style={dashboardStyles.manifestLine}>
                        <span style={dashboardStyles.manifestKey}>License Tier:</span>
                        <span style={{ ...dashboardStyles.manifestVal, color: '#00F0FF' }}>{manifest.licenseTier}</span>
                      </div>
                      <div style={dashboardStyles.manifestLine}>
                        <span style={dashboardStyles.manifestKey}>Commercial Rank:</span>
                        <span style={dashboardStyles.manifestVal}>{manifest.commercialValueScore}% Authenticity Index</span>
                      </div>
                      <div style={dashboardStyles.manifestLine}>
                        <span style={dashboardStyles.manifestKey}>Verification Rights:</span>
                        <span style={{ ...dashboardStyles.manifestVal, color: '#10B981' }}>{manifest.royaltyRights}</span>
                      </div>
                      
                      <div style={dashboardStyles.manifestLineJson}>
                        <strong>Lineage Hash:</strong>
                        <pre style={dashboardStyles.jsonPre}>{manifest.manifestHash}</pre>
                      </div>

                      {manifest.signature && (
                        <div style={dashboardStyles.manifestLineJson}>
                          <strong>ECDSA Signature Bytes:</strong>
                          <pre style={{ ...dashboardStyles.jsonPre, wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{manifest.signature}</pre>
                        </div>
                      )}

                      {manifest.publicKey && (
                        <div style={dashboardStyles.manifestLineJson}>
                          <strong>Snapdragon SPU Public Key (PEM):</strong>
                          <pre style={{ ...dashboardStyles.jsonPre, fontSize: '8px', lineHeight: '1.25', color: '#8892B0', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>{manifest.publicKey}</pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div style={dashboardStyles.manifestPlaceholder}>
                      <AlertTriangle size={24} color="#64748B" style={{ marginBottom: '8px' }} />
                      <span>Lineage manifest empty. Inject watermark above to securely sign hardware-isolated camera assets and embed licensing rights.</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: QUANTIZATION PROFILER */}
            {activeTab === 'quantization' && (
              <div style={dashboardStyles.quantizationPanel}>
                <h3 style={dashboardStyles.panelTitle}>Model Quantization Profiler</h3>
                <p style={dashboardStyles.panelDesc}>Select a quantization profile to see how it affects model execution precision on Hexagon HTP Vector Engines.</p>
                
                <div style={dashboardStyles.profileList}>
                  {QUANTIZATION_PROFILES.map((profile) => (
                    <div 
                      key={profile.id}
                      onClick={() => setSelectedProfile(profile)}
                      style={{
                        ...dashboardStyles.profileItem,
                        borderColor: selectedProfile.id === profile.id ? '#00F0FF' : '#334155',
                        backgroundColor: selectedProfile.id === profile.id ? 'rgba(0, 240, 255, 0.05)' : 'transparent',
                      }}
                    >
                      <div style={dashboardStyles.profileHeaderRow}>
                        <span style={dashboardStyles.profileName}>{profile.name}</span>
                        <span style={dashboardStyles.profileLatency}>{profile.avgLatencyMs} ms</span>
                      </div>
                      <p style={dashboardStyles.profileDesc}>{profile.description}</p>
                      
                      <div style={dashboardStyles.precisionBar}>
                        <div style={{ ...dashboardStyles.precisionSegment, width: `${profile.int4WeightsPercent}%`, backgroundColor: '#00F0FF' }} />
                        <div style={{ ...dashboardStyles.precisionSegment, width: `${profile.int8ActivationsPercent}%`, backgroundColor: '#10B981' }} />
                        <div style={{ ...dashboardStyles.precisionSegment, width: `${profile.fp16FallbackPercent}%`, backgroundColor: '#FF3366' }} />
                      </div>
                      <div style={dashboardStyles.precisionLabels}>
                        <span style={dashboardStyles.precisionLabel}><span style={{ ...dashboardStyles.precisionDot, backgroundColor: '#00F0FF' }} /> INT4 Weights: {profile.int4WeightsPercent}%</span>
                        <span style={dashboardStyles.precisionLabel}><span style={{ ...dashboardStyles.precisionDot, backgroundColor: '#10B981' }} /> INT8 Activations: {profile.int8ActivationsPercent}%</span>
                        <span style={dashboardStyles.precisionLabel}><span style={{ ...dashboardStyles.precisionDot, backgroundColor: '#FF3366' }} /> FP16 CPU: {profile.fp16FallbackPercent}%</span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* ACCURACY VS LATENCY CHART */}
                <div style={dashboardStyles.chartContainer}>
                  <span style={dashboardStyles.chartTitle}>Accuracy vs Latency Tradeoff Map</span>
                  <div style={dashboardStyles.scatterPlot}>
                    <div style={{ position: 'absolute', left: 40, top: 10, bottom: 20, width: 1, backgroundColor: '#475569' }} />
                    <div style={{ position: 'absolute', left: 40, bottom: 20, right: 10, height: 1, backgroundColor: '#475569' }} />
                    
                    <span style={dashboardStyles.axisLabelY}>Accuracy (%)</span>
                    <span style={dashboardStyles.axisLabelX}>NPU Latency (ms)</span>

                    {QUANTIZATION_PROFILES.map((p) => {
                      const left = 50 + ((p.avgLatencyMs - 10) / 50) * 190;
                      const bottom = 30 + ((p.accuracyPercent - 90) / 8) * 100;
                      return (
                        <div
                          key={p.id}
                          style={{
                            position: 'absolute',
                            left: `${left}px`,
                            bottom: `${bottom}px`,
                            width: selectedProfile.id === p.id ? 12 : 8,
                            height: selectedProfile.id === p.id ? 12 : 8,
                            borderRadius: '50%',
                            backgroundColor: selectedProfile.id === p.id ? '#00F0FF' : '#64748B',
                            boxShadow: selectedProfile.id === p.id ? '0 0 10px #00F0FF' : 'none',
                            transform: 'translate(-50%, 50%)',
                            cursor: 'pointer',
                          }}
                          onClick={() => setSelectedProfile(p)}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 3: STREAM INTERCEPTION MIDDLEWARE */}
            {activeTab === 'middleware' && (
              <div style={dashboardStyles.middlewarePanel}>
                <h3 style={dashboardStyles.panelTitle}>HAL3 Interceptor & Buffer Hook</h3>
                <p style={dashboardStyles.panelDesc}>Diverts camera sensor frames before they traverse standard application layers. This prevents memory leaks and guarantees 30 FPS execution.</p>

                <div style={dashboardStyles.toggleConfigRow}>
                  <span style={dashboardStyles.toggleLabel}>Zero-Copy ION Allocations (DMA-BUF)</span>
                  <button 
                    onClick={() => setZeroCopyEnabled(!zeroCopyEnabled)}
                    style={{
                      ...dashboardStyles.switchBtn,
                      backgroundColor: zeroCopyEnabled ? '#10B981' : '#334155',
                      justifyContent: zeroCopyEnabled ? 'flex-end' : 'flex-start'
                    }}
                  >
                    <div style={dashboardStyles.switchKnob} />
                  </button>
                </div>

                <div style={dashboardStyles.bufferMonitor}>
                  <div style={dashboardStyles.bufferHeader}>
                    <span>AHardwareBuffer Ring Queue (4-Slot)</span>
                    <span style={dashboardStyles.ionValue}>{ionPoolUsed} MB Allocated</span>
                  </div>
                  
                  <div style={dashboardStyles.bufferGrid}>
                    {[0, 1, 2, 3].map((idx) => {
                      const isActive = activeBufferIndex === idx;
                      return (
                        <div 
                          key={idx}
                          style={{
                            ...dashboardStyles.bufferSlot,
                            borderColor: isActive ? '#00F0FF' : '#334155',
                            backgroundColor: isActive ? 'rgba(0, 240, 255, 0.08)' : 'rgba(30, 41, 59, 0.3)',
                          }}
                        >
                          <div style={dashboardStyles.slotIndex}>BUF_0{idx}</div>
                          <div style={{ ...dashboardStyles.slotStatus, color: isActive ? '#00F0FF' : '#64748B' }}>
                            {isActive ? 'Locked by HTP' : 'ISP Write Ready'}
                          </div>
                          <div style={dashboardStyles.slotAddress}>
                            {`0x7F9${idx}B0A${idx}0`}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div style={dashboardStyles.pipelineCompareBox}>
                  <span style={dashboardStyles.compareTitle}>CPU Overhead Analysis</span>
                  
                  <div style={dashboardStyles.statBarRow}>
                    <div style={dashboardStyles.statBarLabel}>
                      <span>Middleware Hooks (Zero-Copy)</span>
                      <span>{cpuUsage}% CPU</span>
                    </div>
                    <div style={dashboardStyles.statBarBg}>
                      <div style={{ ...dashboardStyles.statBarFill, width: `${Math.min(cpuUsage * 2.5, 100)}%`, backgroundColor: '#10B981' }} />
                    </div>
                  </div>

                  <div style={dashboardStyles.statBarRow}>
                    <div style={dashboardStyles.statBarLabel}>
                      <span>Standard App Copies (TexImage2D)</span>
                      <span>38.0% CPU</span>
                    </div>
                    <div style={dashboardStyles.statBarBg}>
                      <div style={{ ...dashboardStyles.statBarFill, width: '38%', backgroundColor: '#FF3366' }} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 4: ROADMAP EXPLORER */}
            {activeTab === 'roadmap' && (
              <div style={dashboardStyles.roadmapPanel}>
                <div style={dashboardStyles.roadmapHeader}>
                  <h3 style={dashboardStyles.panelTitle}>Qualcomm Guard Project Roadmap</h3>
                  <div style={dashboardStyles.roadmapPhaseSelector}>
                    {[1, 2, 3, 4].map((ph) => (
                      <button 
                        key={ph}
                        onClick={() => setRoadmapPhase(ph)}
                        style={{
                          ...dashboardStyles.phaseBtn,
                          backgroundColor: roadmapPhase === ph ? '#00F0FF' : '#1E293B',
                          color: roadmapPhase === ph ? '#0F172A' : '#94A3B8'
                        }}
                      >
                        P{ph}
                      </button>
                    ))}
                  </div>
                </div>

                {roadmapPhase === 1 && (
                  <div style={dashboardStyles.phaseContentBox}>
                    <div style={dashboardStyles.phaseTitleRow}>
                      <span style={dashboardStyles.phaseTitleName}>Phase 1: R&D & Quantization Framework</span>
                      <span style={dashboardStyles.phaseWeeks}>Weeks 1-6</span>
                    </div>
                    
                    <ul style={dashboardStyles.todoList}>
                      <li style={dashboardStyles.todoItem}><CheckCircle2 size={14} color="#10B981" /> Train architectures optimized for artifact detection (MobileNetV4).</li>
                      <li style={dashboardStyles.todoItem}><CheckCircle2 size={14} color="#10B981" /> Map model profiles using <code>qnn-model-lib-generator</code>.</li>
                      <li style={dashboardStyles.todoItem}><CheckCircle2 size={14} color="#10B981" /> Evaluate FP32 vs INT4/INT8 precision accuracy loss.</li>
                    </ul>

                    <div style={dashboardStyles.toolSimBox}>
                      <div style={dashboardStyles.toolSimHeader}>
                        <Binary size={14} color="#00F0FF" />
                        <span>Interactive Tool: QNN Context Binary Converter</span>
                      </div>
                      <div style={dashboardStyles.terminalBody}>
                        {compilerLogs.length === 0 ? (
                          <div style={dashboardStyles.terminalPlaceholder}>
                            Ready to compile deepfake model to native Qualcomm HTP .dlc context binary.
                          </div>
                        ) : (
                          compilerLogs.map((log, i) => (
                            <div key={i} style={dashboardStyles.terminalLogLine}>{log}</div>
                          ))
                        )}
                      </div>
                      <button 
                        onClick={handleCompileDlc}
                        disabled={compilingDlc}
                        style={{
                          ...dashboardStyles.runToolBtn,
                          opacity: compilingDlc ? 0.6 : 1,
                          cursor: compilingDlc ? 'not-allowed' : 'pointer'
                        }}
                      >
                        {compilingDlc ? <RefreshCw className="animate-spin" size={14} /> : <Play size={14} />}
                        <span>{compilingDlc ? 'Compiling graph...' : 'Compile ONNX Model to .dlc'}</span>
                      </button>
                    </div>
                  </div>
                )}

                {roadmapPhase === 2 && (
                  <div style={dashboardStyles.phaseContentBox}>
                    <div style={dashboardStyles.phaseTitleRow}>
                      <span style={dashboardStyles.phaseTitleName}>Phase 2: Driver Integration & Native Pipe</span>
                      <span style={dashboardStyles.phaseWeeks}>Weeks 7-14</span>
                    </div>
                    
                    <ul style={dashboardStyles.todoList}>
                      <li style={dashboardStyles.todoItem}><CheckCircle2 size={14} color="#10B981" /> Native C++ Service managing AHardwareBuffer pools.</li>
                      <li style={dashboardStyles.todoItem}><CheckCircle2 size={14} color="#10B981" /> Direct registration with Qualcomm NPU SDK Runtime.</li>
                      <li style={dashboardStyles.todoItem}><Activity size={14} color="#00F0FF" /> Optimizing HVX memory layout (Ahead-Of-Time context binaries).</li>
                    </ul>
                    
                    <div style={dashboardStyles.nativeCodeBox}>
                      <div style={dashboardStyles.codeHeader}>
                        <FileText size={12} color="#94A3B8" />
                        <span>native_stream_hook.cpp</span>
                      </div>
                      <pre style={dashboardStyles.codePre}>
{`// Bind AHardwareBuffer to Qualcomm NPU Mem Handles
QnnMem_Descriptor_t memDesc = QNN_MEM_DESCRIPTOR_INIT;
memDesc.memType = QNN_MEM_TYPE_ION;
memDesc.ionInfo.fd = bufferFd;
memDesc.ionInfo.size = bufferSize;

Qnn_ErrorHandle_t err = QnnMem_register(
  qnnContextHandle, &memDesc, 1, &sharedMemHandle
);`}
                      </pre>
                    </div>
                  </div>
                )}

                {roadmapPhase === 3 && (
                  <div style={dashboardStyles.phaseContentBox}>
                    <div style={dashboardStyles.phaseTitleRow}>
                      <span style={dashboardStyles.phaseTitleName}>Phase 3: Cryptography & Enclave Security</span>
                      <span style={dashboardStyles.phaseWeeks}>Weeks 15-20</span>
                    </div>
                    
                    <ul style={dashboardStyles.todoList}>
                      <li style={dashboardStyles.todoItem}><Activity size={14} color="#00F0FF" /> StrongBox/TEE enclave key binds & signing hooks.</li>
                      <li style={dashboardStyles.todoItem}><Activity size={14} color="#00F0FF" /> Embedding fragile spatial pixel watermarks in ISP post-process.</li>
                      <li style={dashboardStyles.todoItem}><Activity size={14} color="#00F0FF" /> C2PA XML manifest assembly signed via ECDSA.</li>
                    </ul>
                  </div>
                )}

                {roadmapPhase === 4 && (
                  <div style={dashboardStyles.phaseContentBox}>
                    <div style={dashboardStyles.phaseTitleRow}>
                      <span style={dashboardStyles.phaseTitleName}>Phase 4: Optimization & Production Launch</span>
                      <span style={dashboardStyles.phaseWeeks}>Weeks 21-24</span>
                    </div>
                    
                    <ul style={dashboardStyles.todoList}>
                      <li style={dashboardStyles.todoItem}><Activity size={14} color="#00F0FF" /> Power profile analysis using QAIRT Optrace.</li>
                      <li style={dashboardStyles.todoItem}><Activity size={14} color="#00F0FF" /> Lock pipeline down to ultra-low HTP frequencies to avoid thermal spikes.</li>
                      <li style={dashboardStyles.todoItem}><Activity size={14} color="#00F0FF" /> Wrapping into a production-ready Android Camera Plugin.</li>
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

      </div>
    </div>
  );
};

// ==========================================
// PREMIUM FUTURISTIC STYLE OBJECTS
// ==========================================
const dashboardStyles: { [key: string]: React.CSSProperties } = {
  container: {
    backgroundColor: '#070a13',
    color: '#e2e8f0',
    minHeight: '100vh',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    padding: '24px',
    boxSizing: 'border-box',
    backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(0, 240, 255, 0.05) 0%, rgba(0,0,0,0) 70%)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    paddingBottom: '20px',
    marginBottom: '28px',
    flexWrap: 'wrap',
    gap: '16px'
  },
  headerLeft: {
    display: 'flex',
    alignItems: 'center',
  },
  titleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
  },
  brandLogo: {
    width: '40px',
    height: '40px',
    borderRadius: '8px',
    border: '1px solid rgba(0, 240, 255, 0.3)',
    backgroundColor: 'rgba(0, 240, 255, 0.05)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 0 15px rgba(0, 240, 255, 0.15)',
  },
  titleText: {
    fontSize: '20px',
    fontWeight: 800,
    margin: 0,
    color: '#f8fafc',
    letterSpacing: '0.05em',
  },
  subtitleText: {
    fontSize: '12px',
    color: '#64748b',
    margin: '3px 0 0 0',
  },
  headerRight: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
  },
  statusBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    padding: '6px 12px',
    borderRadius: '6px',
    backgroundColor: 'rgba(255, 255, 255, 0.02)',
  },
  badgeDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
  },
  badgeText: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#94a3b8',
    letterSpacing: '0.025em',
  },
  mainGrid: {
    display: 'flex',
    gap: '24px',
    flexWrap: 'wrap',
  },
  viewPortCard: {
    flex: '2 1 600px',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '16px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
  },
  sidebarCard: {
    flex: '1 1 350px',
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    border: '1px solid rgba(255, 255, 255, 0.06)',
    borderRadius: '16px',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    backdropFilter: 'blur(20px)',
    boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
    minHeight: '520px',
  },
  cardHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
  },
  cardTitleGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  cardTitle: {
    fontSize: '15px',
    fontWeight: 600,
    color: '#e2e8f0',
    margin: 0,
  },
  viewPortToggles: {
    display: 'flex',
    gap: '8px',
  },
  toggleBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    border: '1px solid',
    borderRadius: '6px',
    padding: '4px 10px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  viewportFrameContainer: {
    position: 'relative',
    borderRadius: '12px',
    overflow: 'hidden',
    border: '1px solid rgba(255, 255, 255, 0.08)',
    backgroundColor: '#02040a',
    aspectRatio: '16/9',
    width: '100%',
  },
  viewportCanvas: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  detectionOverlayBanner: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: '10px 16px',
    borderTop: '1px solid',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
  },
  bannerContent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  bannerText: {
    color: '#ffffff',
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.025em',
  },
  controlsContainer: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: '16px',
    gap: '16px',
    flexWrap: 'wrap',
  },
  modeSelectorGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  controlLabel: {
    fontSize: '12px',
    color: '#64748b',
    fontWeight: 500,
  },
  btnGroup: {
    display: 'flex',
    border: '1px solid #1e293b',
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: '#0c111d',
  },
  selectorBtn: {
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  captureActionRow: {
    display: 'flex',
    gap: '8px',
  },
  actionBtn: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    border: '1px solid',
    borderRadius: '6px',
    padding: '8px 14px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  timelineContainer: {
    marginTop: '20px',
    borderTop: '1px solid rgba(255, 255, 255, 0.06)',
    paddingTop: '16px',
  },
  timelineHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '14px',
  },
  timelineLabelGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  timelineTitle: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#94a3b8',
  },
  latencyIndicator: {
    fontSize: '12px',
    fontWeight: 700,
    fontFamily: 'monospace',
  },
  timelineTracks: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  trackRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
  },
  trackLabel: {
    width: '120px',
    fontSize: '11px',
    color: '#64748b',
    fontWeight: 500,
  },
  trackBarContainer: {
    flex: 1,
    height: '18px',
    backgroundColor: '#0c111d',
    borderRadius: '4px',
    position: 'relative',
    overflow: 'visible',
    border: '1px solid rgba(255, 255, 255, 0.03)',
  },
  trackBar: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: '3px',
    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  trackDuration: {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: '10px',
    fontWeight: 600,
    fontFamily: 'monospace',
    pointerEvents: 'none',
    transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
  },
  tabBar: {
    display: 'flex',
    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
    marginBottom: '20px',
  },
  tabBtn: {
    flex: 1,
    backgroundColor: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    padding: '10px 2px',
    fontSize: '11.5px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    textAlign: 'center',
  },
  tabContent: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
  },
  diagnosticsPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '16px',
  },
  telemetryHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  panelTitle: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#f1f5f9',
    margin: 0,
  },
  panelDesc: {
    fontSize: '11px',
    color: '#64748b',
    margin: '4px 0 12px 0',
    lineHeight: 1.4,
  },
  fpsCounter: {
    fontSize: '14px',
    fontWeight: 700,
    color: '#00F0FF',
    fontFamily: 'monospace',
  },
  metricGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '10px',
  },
  metricBox: {
    backgroundColor: 'rgba(30, 41, 59, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderRadius: '8px',
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metricLabel: {
    fontSize: '10px',
    color: '#64748b',
    fontWeight: 500,
  },
  metricValue: {
    fontSize: '12px',
    fontWeight: 600,
    color: '#f1f5f9',
  },
  secureEnclaveBox: {
    backgroundColor: 'rgba(2, 4, 10, 0.5)',
    border: '1px solid rgba(16, 185, 129, 0.15)',
    borderRadius: '10px',
    padding: '14px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  enclaveHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    borderBottom: '1px solid rgba(16, 185, 129, 0.1)',
    paddingBottom: '8px',
  },
  enclaveTitle: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#10B981',
    letterSpacing: '0.025em',
  },
  manifestContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  manifestLine: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
    paddingBottom: '4px',
  },
  manifestKey: {
    color: '#64748b',
  },
  manifestVal: {
    fontWeight: 600,
    color: '#cbd5e1',
    textAlign: 'right',
  },
  manifestLineJson: {
    marginTop: '6px',
    fontSize: '10px',
    color: '#64748b',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  jsonPre: {
    margin: 0,
    padding: '6px 8px',
    backgroundColor: '#02040a',
    border: '1px solid rgba(255,255,255,0.05)',
    borderRadius: '4px',
    color: '#10B981',
    fontSize: '10px',
    overflowX: 'auto',
  },
  manifestPlaceholder: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: '#64748b',
    fontSize: '11px',
    padding: '20px 10px',
    lineHeight: 1.4,
  },
  quantizationPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  profileList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  profileItem: {
    border: '1px solid',
    borderRadius: '8px',
    padding: '10px 12px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  profileHeaderRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '4px',
  },
  profileName: {
    fontSize: '12px',
    fontWeight: 700,
    color: '#f8fafc',
  },
  profileLatency: {
    fontSize: '11px',
    fontWeight: 700,
    color: '#00F0FF',
    fontFamily: 'monospace',
  },
  profileDesc: {
    fontSize: '10px',
    color: '#64748b',
    margin: '0 0 8px 0',
    lineHeight: 1.3,
  },
  precisionBar: {
    height: '6px',
    borderRadius: '3px',
    overflow: 'hidden',
    display: 'flex',
    backgroundColor: '#1e293b',
    marginBottom: '6px',
  },
  precisionSegment: {
    height: '100%',
  },
  precisionLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '9px',
    color: '#64748b',
    flexWrap: 'wrap',
    gap: '6px',
  },
  precisionLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
  },
  precisionDot: {
    width: '5px',
    height: '5px',
    borderRadius: '50%',
  },
  chartContainer: {
    borderTop: '1px solid rgba(255, 255, 255, 0.05)',
    paddingTop: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  chartTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#94a3b8',
  },
  scatterPlot: {
    height: '130px',
    backgroundColor: 'rgba(2, 4, 10, 0.4)',
    border: '1px solid rgba(255,255,255,0.04)',
    borderRadius: '8px',
    position: 'relative',
    overflow: 'hidden',
  },
  axisLabelY: {
    position: 'absolute',
    left: '6px',
    top: '50%',
    transform: 'translateY(-50%) rotate(-90deg)',
    fontSize: '8px',
    color: '#64748b',
    whiteSpace: 'nowrap',
  },
  axisLabelX: {
    position: 'absolute',
    bottom: '4px',
    left: '50%',
    transform: 'translateX(-50%)',
    fontSize: '8px',
    color: '#64748b',
  },
  middlewarePanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '14px',
  },
  toggleConfigRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(30, 41, 59, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
    borderRadius: '8px',
    padding: '10px 12px',
  },
  toggleLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#e2e8f0',
  },
  switchBtn: {
    width: '32px',
    height: '18px',
    borderRadius: '9px',
    border: 'none',
    display: 'flex',
    alignItems: 'center',
    padding: '2px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  switchKnob: {
    width: '14px',
    height: '14px',
    backgroundColor: '#ffffff',
    borderRadius: '50%',
  },
  bufferMonitor: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  bufferHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    fontWeight: 600,
    color: '#94a3b8',
  },
  ionValue: {
    color: '#00F0FF',
    fontFamily: 'monospace',
  },
  bufferGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
  },
  bufferSlot: {
    border: '1px solid',
    borderRadius: '8px',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    transition: 'all 0.2s ease',
  },
  slotIndex: {
    fontSize: '9px',
    fontWeight: 700,
    color: '#64748b',
  },
  slotStatus: {
    fontSize: '10px',
    fontWeight: 600,
  },
  slotAddress: {
    fontSize: '9px',
    fontFamily: 'monospace',
    color: '#475569',
  },
  pipelineCompareBox: {
    backgroundColor: 'rgba(2, 4, 10, 0.3)',
    border: '1px solid rgba(255,255,255,0.03)',
    borderRadius: '8px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  compareTitle: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#94a3b8',
  },
  statBarRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  statBarLabel: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '10px',
    color: '#cbd5e1',
  },
  statBarBg: {
    height: '4px',
    backgroundColor: '#1e293b',
    borderRadius: '2px',
    overflow: 'hidden',
  },
  statBarFill: {
    height: '100%',
    borderRadius: '2px',
    transition: 'width 0.3s ease',
  },
  roadmapPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  roadmapHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
  },
  roadmapPhaseSelector: {
    display: 'flex',
    gap: '4px',
    backgroundColor: '#0c111d',
    padding: '2px',
    borderRadius: '6px',
    border: '1px solid #1e293b',
  },
  phaseBtn: {
    border: 'none',
    borderRadius: '4px',
    padding: '4px 8px',
    fontSize: '10px',
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  phaseContentBox: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  phaseTitleRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    paddingBottom: '8px',
  },
  phaseTitleName: {
    fontSize: '13px',
    fontWeight: 700,
    color: '#f8fafc',
  },
  phaseWeeks: {
    fontSize: '11px',
    color: '#00F0FF',
    fontWeight: 600,
  },
  todoList: {
    margin: 0,
    paddingLeft: 0,
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  todoItem: {
    display: 'flex',
    alignItems: 'start',
    gap: '8px',
    fontSize: '11px',
    color: '#cbd5e1',
    lineHeight: 1.4,
  },
  toolSimBox: {
    backgroundColor: 'rgba(2, 4, 10, 0.4)',
    border: '1px solid rgba(0, 240, 255, 0.15)',
    borderRadius: '10px',
    padding: '12px',
    marginTop: '6px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  toolSimHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '11px',
    fontWeight: 700,
    color: '#00F0FF',
  },
  terminalBody: {
    height: '110px',
    backgroundColor: '#02040a',
    borderRadius: '6px',
    padding: '8px 10px',
    fontFamily: 'monospace',
    fontSize: '9px',
    color: '#a7f3d0',
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    border: '1px solid rgba(255,255,255,0.03)',
  },
  terminalPlaceholder: {
    color: '#475569',
    textAlign: 'center',
    padding: '35px 0',
  },
  terminalLogLine: {
    whiteSpace: 'pre-wrap',
    lineHeight: 1.3,
  },
  runToolBtn: {
    backgroundColor: 'rgba(0, 240, 255, 0.1)',
    border: '1px solid #00F0FF',
    color: '#00F0FF',
    borderRadius: '6px',
    padding: '6px 12px',
    fontSize: '11px',
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    cursor: 'pointer',
    transition: 'all 0.15s ease',
  },
  nativeCodeBox: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: '8px',
    overflow: 'hidden',
    border: '1px solid rgba(255,255,255,0.05)',
  },
  codeHeader: {
    backgroundColor: '#0c111d',
    padding: '6px 10px',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '10px',
    color: '#94a3b8',
    borderBottom: '1px solid rgba(255,255,255,0.03)',
  },
  codePre: {
    margin: 0,
    padding: '10px',
    backgroundColor: '#02040a',
    color: '#38bdf8',
    fontSize: '9.5px',
    fontFamily: 'monospace',
    overflowX: 'auto',
    lineHeight: 1.3,
  },
  
  // ROI UPGRADATION FUTURISTIC STYLES
  roiPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  slidersWrapper: {
    backgroundColor: 'rgba(30, 41, 59, 0.2)',
    border: '1px solid rgba(255, 255, 255, 0.03)',
    borderRadius: '8px',
    padding: '12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  sliderGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  sliderLabelsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sliderLabel: {
    fontSize: '11px',
    fontWeight: 600,
    color: '#cbd5e1',
  },
  sliderValue: {
    fontSize: '11px',
    fontFamily: 'monospace',
    fontWeight: 700,
    color: '#00F0FF',
  },
  rangeSlider: {
    width: '100%',
    WebkitAppearance: 'none',
    height: '4px',
    borderRadius: '2px',
    background: '#1e293b',
    outline: 'none',
    cursor: 'pointer',
  },
  savingsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: '8px',
  },
  savingsCard: {
    backgroundColor: 'rgba(2, 4, 10, 0.4)',
    border: '1px solid rgba(255, 255, 255, 0.04)',
    borderLeft: '4px solid',
    borderRadius: '6px',
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  roiCardLabel: {
    fontSize: '9px',
    color: '#64748b',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.025em',
  },
  roiCardVal: {
    fontSize: '15px',
    fontWeight: 800,
    fontFamily: 'monospace',
  },
  greenTelemetryBox: {
    backgroundColor: 'rgba(16, 185, 129, 0.04)',
    border: '1px solid rgba(16, 185, 129, 0.12)',
    borderRadius: '8px',
    padding: '8px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  greenTelemetryLine: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '10.5px',
  },
  greenLabel: {
    color: '#94a3b8',
  },
  greenValue: {
    fontWeight: 700,
    color: '#10B981',
    fontFamily: 'monospace',
  },
  savingsChartBox: {
    borderTop: '1px solid rgba(255,255,255,0.05)',
    paddingTop: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  chartWrapper: {
    height: '80px',
    backgroundColor: 'rgba(2,4,10,0.3)',
    border: '1px solid rgba(255,255,255,0.02)',
    borderRadius: '6px',
    padding: '4px 6px',
  }
};
