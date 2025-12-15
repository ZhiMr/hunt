
import React, { useEffect, useRef } from 'react';
import { COLORS } from '../constants';

// Simplified Entity for the Menu
interface MenuEntity {
  x: number;
  y: number;
  angle: number;
  speed: number;
  size: number;
  color: string;
  turnTimer: number;
}

export const MenuBackground: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let width = window.innerWidth;
    let height = window.innerHeight;

    // Handle Resize
    const handleResize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    window.addEventListener('resize', handleResize);
    handleResize();

    // --- Init World ---
    const sheep: MenuEntity[] = [];
    const trees: { x: number; y: number; size: number }[] = [];

    // Spawn Sheep
    for (let i = 0; i < 30; i++) {
      sheep.push({
        x: Math.random() * width,
        y: Math.random() * height,
        angle: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.4,
        size: 10 + Math.random() * 4,
        color: COLORS.DEER,
        turnTimer: Math.random() * 100
      });
    }

    // Spawn Trees
    for (let i = 0; i < 20; i++) {
      trees.push({
        x: Math.random() * width,
        y: Math.random() * height,
        size: 20 + Math.random() * 20
      });
    }

    // --- Drawing Helper ---
    const drawSheep = (ctx: CanvasRenderingContext2D, s: MenuEntity) => {
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.angle);
      
      // Shadow
      ctx.fillStyle = 'rgba(0,0,0,0.2)';
      ctx.beginPath();
      ctx.ellipse(2, 4, s.size, s.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Scale to match GameCanvas drawing assumptions (based on size ~12)
      const scale = s.size / 12;
      ctx.scale(scale, scale);

      // Body (Rectangle style like GameCanvas)
      ctx.fillStyle = s.color;
      ctx.fillRect(-8, -5, 16, 10);

      // Head
      ctx.beginPath();
      ctx.arc(8, 0, 5, 0, Math.PI * 2); 
      ctx.fill();

      // Antlers
      ctx.strokeStyle = '#5c4033';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(8, -2); ctx.lineTo(12, -8);
      ctx.moveTo(8, 2); ctx.lineTo(12, 8);
      ctx.stroke();

      ctx.restore();
    };

    const drawTree = (ctx: CanvasRenderingContext2D, t: { x: number; y: number; size: number }) => {
      ctx.save();
      ctx.translate(t.x, t.y);
      
      // Trunk
      ctx.fillStyle = '#4a2c2a';
      ctx.fillRect(-4, -5, 8, 10);
      
      // Leaves
      ctx.fillStyle = COLORS.TREE; 
      ctx.beginPath();
      ctx.moveTo(0, -t.size * 2);
      ctx.lineTo(t.size * 0.8, 0);
      ctx.lineTo(-t.size * 0.8, 0);
      ctx.fill();
      
      ctx.restore();
    };

    // --- Loop ---
    const loop = () => {
      ctx.fillStyle = COLORS.GROUND_DAY;
      ctx.fillRect(0, 0, width, height);

      // Draw Trees (Background layer)
      trees.forEach(t => drawTree(ctx, t));

      // Update & Draw Sheep
      sheep.forEach(s => {
        // Move
        s.x += Math.cos(s.angle) * s.speed;
        s.y += Math.sin(s.angle) * s.speed;

        // Wrap around screen
        if (s.x < -50) s.x = width + 50;
        if (s.x > width + 50) s.x = -50;
        if (s.y < -50) s.y = height + 50;
        if (s.y > height + 50) s.y = -50;

        // AI Logic
        s.turnTimer--;
        if (s.turnTimer <= 0) {
          s.turnTimer = 100 + Math.random() * 200;
          s.angle += (Math.random() - 0.5) * 1.5; // Turn slightly
        }

        drawSheep(ctx, s);
      });

      // Simple vignette
      const gradient = ctx.createRadialGradient(width/2, height/2, height/2, width/2, height/2, Math.max(width, height));
      gradient.addColorStop(0, 'rgba(0,0,0,0)');
      gradient.addColorStop(1, 'rgba(0,0,0,0.6)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, width, height);

      animationFrameId = requestAnimationFrame(loop);
    };

    loop();

    return () => {
      window.removeEventListener('resize', handleResize);
      cancelAnimationFrame(animationFrameId);
    };
  }, []);

  return (
    <canvas 
      ref={canvasRef} 
      className="fixed inset-0 w-full h-full pointer-events-none z-0"
    />
  );
};
