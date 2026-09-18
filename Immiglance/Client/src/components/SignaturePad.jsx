import { useEffect, useRef, useState } from "react";

// Plain <canvas> + pointer events — no signature-pad dependency exists in
// this app and one small hand-rolled component isn't worth adding one for
// (same reasoning as BrandMark.jsx skipping lucide-react for one icon).
// Emits a PNG data URL via onChange after each completed stroke, and
// `null` on Clear — the caller decides what "signed" means (non-null value).
export default function SignaturePad({ onChange, height = 160 }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [isEmpty, setIsEmpty] = useState(true);

  // Backs the canvas' drawing buffer by devicePixelRatio so strokes stay
  // crisp on high-DPI screens, while its CSS size stays the layout size.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1e293b";
  }, []);

  const pointFromEvent = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const handlePointerDown = (event) => {
    event.preventDefault();
    canvasRef.current.setPointerCapture(event.pointerId);
    drawingRef.current = true;
    lastPointRef.current = pointFromEvent(event);
  };

  const handlePointerMove = (event) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current.getContext("2d");
    const point = pointFromEvent(event);
    ctx.beginPath();
    ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
    if (isEmpty) setIsEmpty(false);
  };

  const finishStroke = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    onChange?.(canvasRef.current.toDataURL("image/png"));
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
    onChange?.(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-sm font-semibold text-foreground">Draw your signature</p>
        <button type="button" onClick={handleClear} className="text-xs font-semibold text-muted-foreground hover:text-foreground transition">
          Clear
        </button>
      </div>
      <canvas
        ref={canvasRef}
        style={{ height }}
        className="w-full rounded-xl border border-border bg-card cursor-crosshair touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerLeave={finishStroke}
      />
      <p className="mt-1.5 text-xs text-muted-foreground">Use your mouse, trackpad, or finger to sign above.</p>
    </div>
  );
}
