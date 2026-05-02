
import React, { useState, useRef, useEffect } from 'react';
import { X, Check, RotateCw, RefreshCw, Square, Expand } from 'lucide-react';

interface ImageCropperProps {
  imageSrc: string;
  onCrop: (croppedImage: string) => void;
  onCancel: () => void;
}

export const ImageCropper: React.FC<ImageCropperProps> = ({ imageSrc, onCrop, onCancel }) => {
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [lastTouchDist, setLastTouchDist] = useState<number | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [imgAspect, setImgAspect] = useState(1);
  const [originalAspect, setOriginalAspect] = useState(1);
  const [isOriginalAspect, setIsOriginalAspect] = useState(false);
  
  const imgRef = useRef<HTMLImageElement>(null);
  
  const currentAspect = isOriginalAspect ? originalAspect : 1;
  const baseSize = window.innerWidth * 0.85; // Responsive viewport size
  const viewportWidth = currentAspect >= 1 ? baseSize : baseSize * currentAspect;
  const viewportHeight = currentAspect <= 1 ? baseSize : baseSize / currentAspect;

  // Reset state when image changes
  useEffect(() => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
    setIsOriginalAspect(false);
  }, [imageSrc]);

  const handleMouseDown = (clientX: number, clientY: number) => {
    setIsDragging(true);
    setShowGrid(true);
    setDragStart({ x: clientX - offset.x, y: clientY - offset.y });
  };

  const handleMouseMove = (clientX: number, clientY: number) => {
    if (!isDragging) return;
    setOffset({
      x: clientX - dragStart.x,
      y: clientY - dragStart.y
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      setLastTouchDist(dist);
      setShowGrid(true);
    } else if (e.touches.length === 1) {
      handleMouseDown(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastTouchDist !== null) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      const delta = dist - lastTouchDist;
      // Sensitivity factor for zoom
      setZoom(prev => Math.min(5, Math.max(0.5, prev + delta * 0.01)));
      setLastTouchDist(dist);
    } else if (e.touches.length === 1) {
      handleMouseMove(e.touches[0].clientX, e.touches[0].clientY);
    }
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
    setShowGrid(false);
    setLastTouchDist(null);
  };

  const handleRotate = () => {
    setRotation(prev => (prev + 90) % 360);
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
    setOffset({ x: 0, y: 0 });
  };

  const handleCrop = () => {
    const canvas = document.createElement('canvas');
    const maxSize = 1024; // High-res output
    canvas.width = currentAspect >= 1 ? maxSize : maxSize * currentAspect;
    canvas.height = currentAspect <= 1 ? maxSize : maxSize / currentAspect;
    const ctx = canvas.getContext('2d');
    const img = imgRef.current;

    if (!ctx || !img) return;

    // Fill white background (useful if image doesn't cover whole area)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Calculate scale factor between UI and Canvas
    const scaleFactor = canvas.width / viewportWidth;

    // Center canvas context
    ctx.translate(canvas.width / 2, canvas.height / 2);
    // Apply drag offset
    ctx.translate(offset.x * scaleFactor, offset.y * scaleFactor);
    // Apply rotation
    ctx.rotate((rotation * Math.PI) / 180);
    // Apply zoom
    ctx.scale(zoom, zoom);

    // Draw Image
    let renderWidth, renderHeight;
    
    // Sizing logic matching the UI render
    if (imgAspect > currentAspect) {
        // Image is wider than viewport aspect
        renderHeight = viewportHeight;
        renderWidth = viewportHeight * imgAspect;
    } else {
        // Image is taller than viewport aspect
        renderWidth = viewportWidth;
        renderHeight = viewportWidth / imgAspect;
    }
    
    ctx.drawImage(
        img, 
        - (renderWidth * scaleFactor) / 2, 
        - (renderHeight * scaleFactor) / 2, 
        renderWidth * scaleFactor, 
        renderHeight * scaleFactor
    );

    onCrop(canvas.toDataURL('image/jpeg', 0.9));
  };

  return (
    <div className="absolute inset-0 z-[100] bg-black flex flex-col animate-in fade-in duration-200 select-none">
      
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 z-10 safe-top">
         <button onClick={onCancel} className="p-2 text-white hover:bg-white/10 rounded-full transition-colors">
            <X size={24} />
         </button>
         <h2 className="text-white font-bold text-lg">Crop Image</h2>
         <button onClick={handleCrop} className="p-2 text-white hover:bg-white/10 rounded-full transition-colors">
            <Check size={24} />
         </button>
      </div>

      {/* Main Cropper Area */}
      <div 
           className="flex-1 flex items-center justify-center p-4 overflow-hidden relative bg-black touch-none"
           onMouseUp={handleTouchEnd}
           onMouseLeave={handleTouchEnd}
           onTouchEnd={handleTouchEnd}
      >
        {/* Viewport Border */}
        <div 
            className="relative overflow-hidden shadow-[0_0_0_9999px_rgba(0,0,0,0.8)] border border-white/20 transition-all duration-300"
            style={{ width: viewportWidth, height: viewportHeight }}
        >
             <div 
                className="w-full h-full flex items-center justify-center cursor-move"
                onMouseDown={(e) => handleMouseDown(e.clientX, e.clientY)}
                onMouseMove={(e) => handleMouseMove(e.clientX, e.clientY)}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
             >
                <img 
                    ref={imgRef}
                    src={imageSrc}
                    alt="Crop target"
                    draggable={false}
                    style={{
                        transform: `translate(${offset.x}px, ${offset.y}px) rotate(${rotation}deg) scale(${zoom})`,
                        transformOrigin: 'center',
                        maxWidth: 'none',
                        width: imgAspect > currentAspect ? 'auto' : '100%',
                        height: imgAspect > currentAspect ? '100%' : 'auto',
                    }}
                    className="max-w-none pointer-events-none select-none transition-transform duration-75 ease-linear"
                    onLoad={(e) => {
                        const img = e.currentTarget;
                        const aspect = img.naturalWidth / img.naturalHeight;
                        setImgAspect(aspect);
                        // Clamp aspect ratio between 4:5 (0.8) and 16:9 (1.77) similar to Instagram
                        setOriginalAspect(Math.max(0.8, Math.min(1.77, aspect)));
                    }}
                />
             </div>
             
             {/* WhatsApp-style Grid Guidelines (3x3) */}
             <div className={`absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none transition-opacity duration-200 ${showGrid ? 'opacity-100' : 'opacity-30'}`}>
                <div className="border-r border-white/30 border-b border-white/30"></div>
                <div className="border-r border-white/30 border-b border-white/30"></div>
                <div className="border-b border-white/30"></div>
                <div className="border-r border-white/30 border-b border-white/30"></div>
                <div className="border-r border-white/30 border-b border-white/30"></div>
                <div className="border-b border-white/30"></div>
                <div className="border-r border-white/30"></div>
                <div className="border-r border-white/30"></div>
             </div>
             
             {/* WhatsApp-style Corner Handles */}
             <div className="absolute top-0 left-0 w-6 h-6 border-t-[3px] border-l-[3px] border-white pointer-events-none"></div>
             <div className="absolute top-0 right-0 w-6 h-6 border-t-[3px] border-r-[3px] border-white pointer-events-none"></div>
             <div className="absolute bottom-0 left-0 w-6 h-6 border-b-[3px] border-l-[3px] border-white pointer-events-none"></div>
             <div className="absolute bottom-0 right-0 w-6 h-6 border-b-[3px] border-r-[3px] border-white pointer-events-none"></div>
        </div>
      </div>

      {/* Bottom Bar Controls */}
      <div className="px-10 py-8 bg-black/90 backdrop-blur-md flex justify-between items-center pb-safe border-t border-white/5">
         <button 
           onClick={handleReset} 
           className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors"
           title="Reset"
         >
           <RefreshCw size={22} />
           <span className="text-[10px] font-bold uppercase tracking-wider">Reset</span>
         </button>
         
         <button 
           onClick={handleRotate} 
           className="flex flex-col items-center gap-1.5 text-gray-400 hover:text-white transition-colors"
           title="Rotate"
         >
           <RotateCw size={22} />
           <span className="text-[10px] font-bold uppercase tracking-wider">Rotate</span>
         </button>
         
         <button 
           onClick={() => setIsOriginalAspect(!isOriginalAspect)}
           className={`flex flex-col items-center gap-1.5 transition-colors ${isOriginalAspect ? 'text-white' : 'text-blue-500'}`}
           title="Aspect Ratio"
         >
           <Expand size={22} />
           <span className="text-[10px] font-bold uppercase tracking-wider">{isOriginalAspect ? 'Original' : 'Square'}</span>
         </button>
      </div>
    </div>
  );
};
