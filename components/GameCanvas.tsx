import React, { useRef, useEffect } from 'react';
import { GameState, Entity, EntityType, Vector2 } from '../types';
import { COLORS, VISION_RADIUS_DAY, VISION_RADIUS_NIGHT, VISION_RADIUS_DIM, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, MAP_SIZE, TREE_COLLISION_RATIO } from '../constants';
import { distance } from '../utils/gameLogic';

interface GameCanvasProps {
  gameState: GameState;
  cameraTarget: 'HUNTER' | 'DEMON';
}

const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, cameraTarget }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // --- Rendering Helpers ---
  const drawEntity = (ctx: CanvasRenderingContext2D, entity: Entity, color: string, isDemon = false) => {
    ctx.save();
    ctx.translate(entity.pos.x, entity.pos.y);
    
    // Shadow
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath();
    ctx.ellipse(2, 4, entity.size, entity.size * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body
    ctx.fillStyle = color;
    
    if (entity.type === EntityType.TREE) {
      // Draw Pixel Art Tree (Simple Shapes)
      ctx.fillStyle = '#4a2c2a'; // Trunk
      ctx.fillRect(-6, -entity.size, 12, entity.size);
      ctx.fillStyle = color; // Leaves
      ctx.beginPath();
      ctx.moveTo(0, -entity.size * 2.5);
      ctx.lineTo(entity.size, -entity.size * 0.5);
      ctx.lineTo(-entity.size, -entity.size * 0.5);
      ctx.fill();
    } else if (entity.type === EntityType.CABIN) {
      ctx.fillStyle = color;
      ctx.fillRect(-entity.size, -entity.size, entity.size * 2, entity.size * 2);
      // Roof
      ctx.beginPath();
      ctx.moveTo(-entity.size - 5, -entity.size);
      ctx.lineTo(0, -entity.size * 2);
      ctx.lineTo(entity.size + 5, -entity.size);
      ctx.fill();

      // Draw Door (Only visible at Night)
      if (gameState.isNight) {
          ctx.fillStyle = '#000'; // Open door
          // Bottom center
          ctx.fillRect(-10, entity.size - 1, 20, 4);
      }

    } else if (entity.type === EntityType.MUSHROOM) {
      ctx.fillStyle = '#fde047'; // Stalk
      ctx.fillRect(-2, 0, 4, 8);
      ctx.fillStyle = color; // Cap
      ctx.beginPath();
      ctx.arc(0, 0, 6, Math.PI, 0);
      ctx.fill();
    } else {
      // Characters (Hunter, Demon, Deer)
      ctx.rotate(entity.angle);
      
      if (entity.type === EntityType.HUNTER) {
         ctx.beginPath();
         ctx.arc(0, 0, entity.size, 0, Math.PI * 2);
         ctx.fill();
         // Gun
         ctx.fillStyle = '#000';
         ctx.fillRect(0, -2, entity.size + 10, 4);
      } else if (entity.type === EntityType.DEER || (entity.type === EntityType.DEMON && !isDemon)) {
         // Deer Shape
         ctx.fillStyle = color;
         ctx.fillRect(-8, -5, 16, 10); // Body
         ctx.beginPath();
         ctx.arc(8, 0, 5, 0, Math.PI * 2); // Head
         ctx.fill();
         // Antlers
         ctx.strokeStyle = '#5c4033';
         ctx.lineWidth = 2;
         ctx.beginPath();
         ctx.moveTo(8, -2); ctx.lineTo(12, -8);
         ctx.moveTo(8, 2); ctx.lineTo(12, 8);
         ctx.stroke();
      } else if (entity.type === EntityType.DEMON && isDemon) {
        // Monster Shape
        ctx.fillStyle = COLORS.DEMON_NIGHT;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-10, 10);
        ctx.lineTo(-5, 0);
        ctx.lineTo(-10, -10);
        ctx.fill();
        // Glowing Eyes
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.arc(5, -3, 2, 0, Math.PI * 2);
        ctx.arc(5, 3, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  };

  // --- Math Helpers for Analytic Intersection ---
  const intersectRayCircle = (rayOrigin: Vector2, rayDir: Vector2, circlePos: Vector2, radius: number): number | null => {
    // Vector from Ray Origin to Circle Center
    const fx = rayOrigin.x - circlePos.x;
    const fy = rayOrigin.y - circlePos.y;

    const a = rayDir.x * rayDir.x + rayDir.y * rayDir.y; // Should be 1 if normalized
    const b = 2 * (fx * rayDir.x + fy * rayDir.y);
    const c = (fx * fx + fy * fy) - (radius * radius);

    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) return null;

    const t1 = (-b - Math.sqrt(discriminant)) / (2 * a);
    const t2 = (-b + Math.sqrt(discriminant)) / (2 * a);

    // We want the closest positive t
    if (t1 > 0 && t2 > 0) return Math.min(t1, t2);
    if (t1 > 0) return t1;
    if (t2 > 0) return t2;
    return null;
  };

  const intersectRayAABB = (rayOrigin: Vector2, rayDir: Vector2, boxPos: Vector2, boxHalfSize: number): number | null => {
    // AABB Bounds
    const minX = boxPos.x - boxHalfSize;
    const maxX = boxPos.x + boxHalfSize;
    const minY = boxPos.y - boxHalfSize;
    const maxY = boxPos.y + boxHalfSize;

    // Slab method
    let tmin = -Infinity;
    let tmax = Infinity;

    if (rayDir.x !== 0) {
      const tx1 = (minX - rayOrigin.x) / rayDir.x;
      const tx2 = (maxX - rayOrigin.x) / rayDir.x;
      tmin = Math.max(tmin, Math.min(tx1, tx2));
      tmax = Math.min(tmax, Math.max(tx1, tx2));
    } else if (rayOrigin.x < minX || rayOrigin.x > maxX) {
        return null; // Parallel and outside
    }

    if (rayDir.y !== 0) {
      const ty1 = (minY - rayOrigin.y) / rayDir.y;
      const ty2 = (maxY - rayOrigin.y) / rayDir.y;
      tmin = Math.max(tmin, Math.min(ty1, ty2));
      tmax = Math.min(tmax, Math.max(ty1, ty2));
    } else if (rayOrigin.y < minY || rayOrigin.y > maxY) {
        return null;
    }

    if (tmax >= tmin && tmin > 0) return tmin;
    return null;
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // --- Camera Logic ---
    const targetEntity = cameraTarget === 'HUNTER' ? gameState.hunter : gameState.demon;
    let camX = targetEntity.pos.x - VIEWPORT_WIDTH / 2;
    let camY = targetEntity.pos.y - VIEWPORT_HEIGHT / 2;

    // Clamp Camera
    camX = Math.max(0, Math.min(camX, MAP_SIZE - VIEWPORT_WIDTH));
    camY = Math.max(0, Math.min(camY, MAP_SIZE - VIEWPORT_HEIGHT));

    // Clear Screen
    ctx.clearRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
    
    // 1. Base Layer: Ground (Dim)
    ctx.save();
    ctx.translate(-camX, -camY);
    ctx.fillStyle = gameState.isNight ? '#052e16' : '#15803d'; // Darker versions for Fog
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    
    // 2. Static Objects (Dim - Fogged)
    const allObstacles = [...gameState.trees, gameState.cabin];
    // Draw dim versions
    allObstacles.forEach(obj => {
       ctx.save();
       ctx.translate(obj.pos.x, obj.pos.y);
       ctx.fillStyle = '#222'; // Silhouette
       // Simple circles/rects for silhouette
       if(obj.type === EntityType.CABIN) ctx.fillRect(-obj.size, -obj.size, obj.size*2, obj.size*2);
       else if(obj.type === EntityType.TREE) {
         // Tree trunk silhouette
         ctx.fillRect(-6, -obj.size, 12, obj.size);
       }
       else { ctx.beginPath(); ctx.arc(0,0, obj.size, 0, Math.PI*2); ctx.fill(); }
       ctx.restore();
    });
    
    ctx.restore(); 

    // 3. Vision Calculation (Fog of War) - OPTIMIZED
    const visionSource = targetEntity; 
    const visionRadius = gameState.isNight ? VISION_RADIUS_NIGHT : VISION_RADIUS_DAY;
    const visionSourceScreenPos = { x: visionSource.pos.x - camX, y: visionSource.pos.y - camY };

    // Pre-filter obstacles that are close enough to matter to save cycles
    const nearbyObstacles = allObstacles.filter(obj => 
        distance(visionSource.pos, obj.pos) < visionRadius + obj.size
    );

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(visionSourceScreenPos.x, visionSourceScreenPos.y);
    
    // INCREASED RAY COUNT AND ANALYTIC INTERSECTION
    const numRays = 360; // Higher count for smoother edges
    
    for (let i = 0; i <= numRays; i++) {
       const angle = (i / numRays) * Math.PI * 2;
       const dir = { x: Math.cos(angle), y: Math.sin(angle) };
       
       let closestDist = visionRadius;

       // Analytic Intersection Check
       for (const obs of nearbyObstacles) {
         let dist: number | null = null;
         
         if (obs.type === EntityType.TREE) {
            // Treat Tree Trunks as Circles for smooth shadows
            const radius = obs.size * TREE_COLLISION_RATIO;
            dist = intersectRayCircle(visionSource.pos, dir, obs.pos, radius);
         } else if (obs.type === EntityType.CABIN) {
            // Cabin is a box
            dist = intersectRayAABB(visionSource.pos, dir, obs.pos, obs.size);
         }

         if (dist !== null && dist < closestDist) {
           closestDist = dist;
         }
       }
       
       ctx.lineTo(visionSourceScreenPos.x + dir.x * closestDist, visionSourceScreenPos.y + dir.y * closestDist);
    }
    ctx.closePath();
    ctx.clip(); // <--- MAGIC: Only draw inside this region (The Light)
    
    // 4. Draw BRIGHT World inside Clip
    ctx.translate(-camX, -camY);
    
    // Bright Ground
    ctx.fillStyle = gameState.isNight ? COLORS.GROUND_NIGHT : COLORS.GROUND_DAY;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    
    // Bright Static Objects
    [gameState.cabin, ...gameState.trees, ...gameState.mushrooms].forEach(obj => {
       drawEntity(ctx, obj, obj.type === EntityType.TREE ? COLORS.TREE : obj.type === EntityType.CABIN ? COLORS.CABIN : COLORS.MUSHROOM);
    });

    // Entities
    [...gameState.deers].forEach(deer => drawEntity(ctx, deer, COLORS.DEER));
    drawEntity(ctx, gameState.demon, gameState.isNight ? COLORS.DEMON_NIGHT : COLORS.DEMON_DAY, gameState.isNight);
    
    // Only draw hunter if NOT in cabin
    if (!gameState.hunter.inCabin) {
        drawEntity(ctx, gameState.hunter, COLORS.HUNTER);
    }
    
    // Bullets
    ctx.fillStyle = '#fbbf24';
    gameState.bullets.forEach(b => { ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, 3, 0, Math.PI * 2); ctx.fill(); });

    ctx.restore();
    
  }, [gameState, cameraTarget]);

  return (
    <canvas 
      ref={canvasRef} 
      width={VIEWPORT_WIDTH} 
      height={VIEWPORT_HEIGHT}
      className="border-4 border-slate-700 rounded-lg shadow-2xl bg-black"
    />
  );
};

export default GameCanvas;