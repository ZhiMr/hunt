import React, { useEffect, useRef, useState } from 'react';
import { InputState } from '../types';
import { Swords } from 'lucide-react';

interface MobileControlsProps {
  inputRef: React.MutableRefObject<InputState>;
  onExit?: () => void;
}

export const MobileControls: React.FC<MobileControlsProps> = ({ inputRef, onExit }) => {
  const joystickRef = useRef<HTMLDivElement>(null);
  const actionBtnRef = useRef<HTMLButtonElement>(null);
  const [stickPos, setStickPos] = useState({ x: 0, y: 0 });
  const touchIdRef = useRef<number | null>(null);

  // Joystick Logic with Native Listeners
  useEffect(() => {
    const el = joystickRef.current;
    if (!el) return;

    const updateJoystick = (touch: Touch) => {
        const rect = el.getBoundingClientRect();
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

    const handleStart = (e: TouchEvent) => {
        e.preventDefault(); // Critical: prevent scrolling
        e.stopPropagation();
        const touch = e.changedTouches[0];
        touchIdRef.current = touch.identifier;
        updateJoystick(touch);
    };

    const handleMove = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (touchIdRef.current === null) return;
        
        let touch: Touch | undefined;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === touchIdRef.current) {
                touch = e.changedTouches[i];
                break;
            }
        }
        
        if (touch) updateJoystick(touch);
    };

    const handleEnd = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        let touch: Touch | undefined;
        for (let i = 0; i < e.changedTouches.length; i++) {
            if (e.changedTouches[i].identifier === touchIdRef.current) {
                touch = e.changedTouches[i];
                break;
            }
        }

        if (touch) {
            setStickPos({ x: 0, y: 0 });
            touchIdRef.current = null;
            // Reset input state
            inputRef.current.up = false;
            inputRef.current.down = false;
            inputRef.current.left = false;
            inputRef.current.right = false;
        }
    };

    // Add native listeners with passive: false
    el.addEventListener('touchstart', handleStart, { passive: false });
    el.addEventListener('touchmove', handleMove, { passive: false });
    el.addEventListener('touchend', handleEnd, { passive: false });
    el.addEventListener('touchcancel', handleEnd, { passive: false });

    return () => {
        el.removeEventListener('touchstart', handleStart);
        el.removeEventListener('touchmove', handleMove);
        el.removeEventListener('touchend', handleEnd);
        el.removeEventListener('touchcancel', handleEnd);
    };
  }, []);

  // Action Button Logic with Native Listeners
  useEffect(() => {
    const el = actionBtnRef.current;
    if (!el) return;

    const handleActionStart = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current.space = true;
        inputRef.current.enter = true;
        el.style.transform = 'scale(0.9)';
    };
    
    const handleActionEnd = (e: TouchEvent) => {
        e.preventDefault();
        e.stopPropagation();
        inputRef.current.space = false;
        inputRef.current.enter = false;
        el.style.transform = 'scale(1)';
    };

    el.addEventListener('touchstart', handleActionStart, { passive: false });
    el.addEventListener('touchend', handleActionEnd, { passive: false });
    el.addEventListener('touchcancel', handleActionEnd, { passive: false });

    return () => {
        el.removeEventListener('touchstart', handleActionStart);
        el.removeEventListener('touchend', handleActionEnd);
        el.removeEventListener('touchcancel', handleActionEnd);
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none z-[100] flex flex-col justify-end pb-8 px-6 select-none touch-none">
      <div className="flex justify-between items-end w-full">
        
        {/* Joystick Area */}
        <div 
          ref={joystickRef}
          className="relative w-32 h-32 bg-white/10 rounded-full backdrop-blur-sm border-2 border-white/20 pointer-events-auto touch-none"
        >
          {/* Stick */}
          <div 
            className="absolute w-12 h-12 bg-white/80 rounded-full shadow-lg transition-transform duration-75 ease-out"
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
                className="w-12 h-12 mb-2 rounded-full bg-red-900/50 border border-red-500 text-red-200 flex items-center justify-center active:scale-90 transition-transform backdrop-blur-sm touch-none"
              >
                <span className="text-xs font-bold">退出</span>
              </button>
          )}

          <button 
            ref={actionBtnRef}
            className="w-20 h-20 rounded-full bg-green-600/80 border-4 border-green-400/50 flex items-center justify-center shadow-lg backdrop-blur-sm touch-none transition-transform"
          >
            <Swords size={32} className="text-white" />
          </button>
        </div>
      </div>
    </div>
  );
};