import React, { useEffect, useRef, useState } from 'react';
import { InputState } from '../types';
import { Swords } from 'lucide-react';

interface MobileControlsProps {
  inputRef: React.MutableRefObject<InputState>;
  onExit?: () => void;
}

export const MobileControls: React.FC<MobileControlsProps> = ({ inputRef, onExit }) => {
  const joystickRef = useRef<HTMLDivElement>(null);
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const touchIdRef = useRef<number | null>(null);

  // Joystick Logic
  const handleStart = (e: React.TouchEvent) => {
    e.preventDefault(); // Prevent scroll
    const touch = e.changedTouches[0];
    touchIdRef.current = touch.identifier;
    setActive(true);
    updateJoystick(touch);
  };

  const handleMove = (e: React.TouchEvent) => {
    e.preventDefault();
    if (touchIdRef.current === null) return;
    
    // Find the touch that started this
    // Iterate manually to avoid TS issues with TouchList iterator or use explicit type
    let touch: React.Touch | undefined;
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
            touch = e.changedTouches[i];
            break;
        }
    }
    
    if (touch) updateJoystick(touch);
  };

  const handleEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    // Only reset if our touch ended
    let touch: React.Touch | undefined;
    for (let i = 0; i < e.changedTouches.length; i++) {
        if (e.changedTouches[i].identifier === touchIdRef.current) {
            touch = e.changedTouches[i];
            break;
        }
    }

    if (touch) {
      setActive(false);
      setStickPos({ x: 0, y: 0 });
      touchIdRef.current = null;
      resetInput();
    }
  };

  const updateJoystick = (touch: React.Touch) => {
    if (!joystickRef.current) return;
    const rect = joystickRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const maxDist = rect.width / 2;
    
    let dx = touch.clientX - centerX;
    let dy = touch.clientY - centerY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Clamp distance
    if (dist > maxDist) {
      dx = (dx / dist) * maxDist;
      dy = (dy / dist) * maxDist;
    }

    setStickPos({ x: dx, y: dy });

    // Map to Input
    // Thresholds for directional input
    const threshold = 20; 
    
    // Reset first
    inputRef.current.up = false;
    inputRef.current.down = false;
    inputRef.current.left = false;
    inputRef.current.right = false;

    if (dy < -threshold) inputRef.current.up = true;
    if (dy > threshold) inputRef.current.down = true;
    if (dx < -threshold) inputRef.current.left = true;
    if (dx > threshold) inputRef.current.right = true;
  };

  const resetInput = () => {
    inputRef.current.up = false;
    inputRef.current.down = false;
    inputRef.current.left = false;
    inputRef.current.right = false;
  };

  // Action Button Logic
  const handleActionStart = (e: React.TouchEvent) => {
    e.preventDefault();
    inputRef.current.space = true; // Use space/enter mapping
    inputRef.current.enter = true;
  };
  
  const handleActionEnd = (e: React.TouchEvent) => {
    e.preventDefault();
    inputRef.current.space = false;
    inputRef.current.enter = false;
  };

  return (
    <div className="fixed inset-0 pointer-events-none z-50 flex flex-col justify-end pb-8 px-6 select-none touch-none">
      <div className="flex justify-between items-end w-full">
        
        {/* Joystick Area */}
        <div 
          ref={joystickRef}
          className="relative w-32 h-32 bg-white/10 rounded-full backdrop-blur-sm border-2 border-white/20 pointer-events-auto"
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          onTouchCancel={handleEnd}
        >
          {/* Stick */}
          <div 
            className={`absolute w-12 h-12 bg-white/80 rounded-full shadow-lg transition-transform duration-75 ease-out`}
            style={{ 
              left: '50%', top: '50%', 
              marginLeft: '-1.5rem', marginTop: '-1.5rem',
              transform: `translate(${stickPos.x}px, ${stickPos.y}px)`
            }}
          />
        </div>

        {/* Action Buttons */}
        <div className="flex gap-4 items-end pointer-events-auto">
          {onExit && (
             <button 
                onClick={onExit}
                className="w-12 h-12 mb-2 rounded-full bg-red-900/50 border border-red-500 text-red-200 flex items-center justify-center active:scale-90 transition-transform backdrop-blur-sm"
              >
                <span className="text-xs font-bold">退出</span>
              </button>
          )}

          <button 
            className="w-20 h-20 rounded-full bg-green-600/80 border-4 border-green-400/50 flex items-center justify-center active:scale-90 active:bg-green-500 transition-transform shadow-lg backdrop-blur-sm"
            onTouchStart={handleActionStart}
            onTouchEnd={handleActionEnd}
          >
            <Swords size={32} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};