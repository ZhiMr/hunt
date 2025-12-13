
import React, { useRef, useEffect } from 'react';
import { GameState, Entity, EntityType, Vector2 } from '../types';
import { COLORS, VISION_RADIUS_DAY, VISION_RADIUS_NIGHT, VISION_RADIUS_BUSH, VIEWPORT_WIDTH, VIEWPORT_HEIGHT, MAP_SIZE, TREE_COLLISION_RATIO, RENDER_SCALE } from '../constants';
import { distance } from '../utils/gameLogic';

interface GameCanvasProps {
  gameState: GameState;
  cameraTarget: 'HUNTER' | 'DEMON';
}

// --- Deterministic Bush Particle Generator ---
// Extracted to ensure Silhouette and Color pass match exactly
const getBushParticles = (entity: Entity) => {
    const seed = Math.floor(entity.pos.x * 1000 + entity.pos.y);
    const rand = ((s) => {
        let val = s;
        return () => {
            val = (val * 9301 + 49297) % 233280;
            return val / 233280;
        };
    })(seed);

    const bushColors = [
        '#022c22', // teal-950
        '#064e3b', // teal-900 
        '#065f46', // teal-800
        '#115e59', // teal-800
        '#134e4a'  // teal-900
    ];

    const leaves = [];
    // 1. Dark Base
    leaves.push({ x: 0, y: 0, r: entity.size * 0.9, color: bushColors[0] });

    // 2. Fluffy Leaves
    const numLeaves = 15;
    for (let i = 0; i < numLeaves; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * entity.size * 0.9;
        const lx = Math.cos(angle) * dist;
        const ly = Math.sin(angle) * dist;
        const lSize = entity.size * (0.35 + rand() * 0.25);

        let colorScore = rand(); 
        if (ly < -entity.size * 0.2) colorScore += 0.3; 
        if (lx < -entity.size * 0.2) colorScore += 0.2; 
        if (ly > entity.size * 0.3) colorScore -= 0.3; 

        let colorIdx = Math.floor(colorScore * bushColors.length);
        colorIdx = Math.max(0, Math.min(colorIdx, bushColors.length - 1));
        
        leaves.push({ x: lx, y: ly, r: lSize, color: bushColors[colorIdx] });
    }

    // 3. Berries
    const berries = [];
    const numBerries = 3 + Math.floor(rand() * 3);
    for (let i = 0; i < numBerries; i++) {
        const angle = rand() * Math.PI * 2;
        const dist = Math.sqrt(rand()) * entity.size * 0.8;
        const bx = Math.cos(angle) * dist;
        const by = Math.sin(angle) * dist;
        const bSize = entity.size * 0.15;
        berries.push({ x: bx, y: by, r: bSize, color: '#fde047' });
    }

    return { leaves, berries };
};

const GameCanvas: React.FC<GameCanvasProps> = ({ gameState, cameraTarget }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bushBufferRef = useRef<HTMLCanvasElement | null>(null); // Offscreen buffer for transparent bushes
  
  // Refs for smoothing vision
  const prevDistancesRef = useRef<Float32Array | null>(null);
  const lastSourcePosRef = useRef<Vector2 | null>(null);

  // --- Rendering Helpers ---
  const drawEntity = (ctx: CanvasRenderingContext2D, entity: Entity, color: string, isDemon = false) => {
    if (!entity || !entity.pos) return; // Safety Check

    ctx.save();
    ctx.translate(entity.pos.x, entity.pos.y);
    
    // Shadow (Ground shadow) - Only for non-bush entities, bush shadow handled in silhouette
    if (entity.type !== EntityType.BUSH) {
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.beginPath();
        ctx.ellipse(2, 4, entity.size, entity.size * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    // Body
    ctx.fillStyle = color;
    
    if (entity.type === EntityType.TREE) {
      // Draw Tree (Simple Shapes)
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
    } else if (entity.type === EntityType.BUSH) {
      // Logic handled in main loop for transparency, but this is fallback for standard draw
      const parts = getBushParticles(entity);
      parts.leaves.forEach(p => {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
      });
      parts.berries.forEach(p => {
          ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
      });
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
    const ctx = canvas.getContext('2d', { alpha: false }); // Optimize alpha
    if (!ctx) return;
    
    // Init Offscreen Buffer
    if (!bushBufferRef.current) {
        bushBufferRef.current = document.createElement('canvas');
    }
    const bufferCtx = bushBufferRef.current.getContext('2d');

    // --- Render Setup ---
    // Reset transform to clear the entire physical canvas
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Enable smoothing for smooth vector-like look
    ctx.imageSmoothingEnabled = true;

    // Apply scaling for High DPI / Resolution
    ctx.scale(RENDER_SCALE, RENDER_SCALE);

    // --- Camera Logic ---
    const targetEntity = cameraTarget === 'HUNTER' ? gameState.hunter : gameState.demon;
    
    // Safety check for camera target existence
    if (!targetEntity || !targetEntity.pos) {
        ctx.fillStyle = '#111';
        ctx.fillRect(0, 0, VIEWPORT_WIDTH, VIEWPORT_HEIGHT);
        ctx.fillStyle = '#666';
        ctx.font = '20px monospace';
        ctx.fillText("WAITING FOR SYNC...", 20, 40);
        return;
    }

    let camX = targetEntity.pos.x - VIEWPORT_WIDTH / 2;
    let camY = targetEntity.pos.y - VIEWPORT_HEIGHT / 2;

    // Clamp Camera
    camX = Math.max(0, Math.min(camX, MAP_SIZE - VIEWPORT_WIDTH));
    camY = Math.max(0, Math.min(camY, MAP_SIZE - VIEWPORT_HEIGHT));

    
    // 1. Base Layer: Ground (Dim)
    ctx.save();
    ctx.translate(-camX, -camY);
    ctx.fillStyle = gameState.isNight ? '#052e16' : '#15803d'; // Darker versions for Fog
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    
    // 2. Static Objects (Dim - Fogged / Silhouette)
    const allObstacles = [...(gameState.trees || []), ...(gameState.bushes || []), gameState.cabin].filter(Boolean);
    
    // Draw dim versions
    allObstacles.forEach(obj => {
       if (!obj) return;
       ctx.save();
       ctx.translate(obj.pos.x, obj.pos.y);
       ctx.fillStyle = '#222'; // Silhouette
       // Simple circles/rects for silhouette
       if(obj.type === EntityType.CABIN) {
           // Body
           ctx.fillRect(-obj.size, -obj.size, obj.size*2, obj.size*2);
           // Roof
           ctx.beginPath();
           ctx.moveTo(-obj.size - 5, -obj.size);
           ctx.lineTo(0, -obj.size * 2);
           ctx.lineTo(obj.size + 5, -obj.size);
           ctx.fill();
       }
       else if(obj.type === EntityType.TREE) {
         // Tree trunk silhouette
         ctx.fillRect(-6, -obj.size, 12, obj.size);
         // Leaves silhouette
         ctx.beginPath();
         ctx.moveTo(0, -obj.size * 2.5);
         ctx.lineTo(obj.size, -obj.size * 0.5);
         ctx.lineTo(-obj.size, -obj.size * 0.5);
         ctx.fill();
       }
       else if (obj.type === EntityType.BUSH) {
         // SILHOUETTE PASS
         // Use the EXACT same particle logic to draw the silhouette
         // This ensures the shadow shape matches the lit shape perfectly
         const parts = getBushParticles(obj);
         parts.leaves.forEach(p => {
             ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
         });
         // Berries not drawn in silhouette
       }
       else { ctx.beginPath(); ctx.arc(0,0, obj.size, 0, Math.PI*2); ctx.fill(); }
       ctx.restore();
    });
    
    ctx.restore(); 

    // 3. Vision Calculation (Fog of War) - OPTIMIZED
    const visionSource = targetEntity; 
    let visionRadius = gameState.isNight ? VISION_RADIUS_NIGHT : VISION_RADIUS_DAY;
    
    // Check if inside a bush (kept for vision reduction mechanics if needed, though bushes are now transparent to rays)
    let insideBushId: string | null = null;
    const bushList = gameState.bushes || [];
    for (const bush of bushList) {
        if (distance(visionSource.pos, bush.pos) < bush.size) {
            insideBushId = bush.id;
            visionRadius = VISION_RADIUS_BUSH; // Reduced vision inside bush
            break;
        }
    }

    const visionSourceScreenPos = { x: visionSource.pos.x - camX, y: visionSource.pos.y - camY };

    // Reset smoothing if position changed dramatically (teleport/respawn) to avoid lag lines
    if (lastSourcePosRef.current && distance(lastSourcePosRef.current, visionSource.pos) > 50) {
        prevDistancesRef.current = null;
    }
    lastSourcePosRef.current = { ...visionSource.pos };

    // Pre-filter obstacles that are close enough to matter
    // EXCLUDE BUSHES from vision blocking to allow seeing "through" them (transparency)
    const nearbyObstacles = allObstacles.filter(obj => 
        obj && 
        obj.type !== EntityType.BUSH && // CHANGE: Bushes do not block vision rays
        distance(visionSource.pos, obj.pos) < visionRadius + obj.size
    );

    // INCREASED RAY COUNT for high fidelity
    const NUM_RAYS = 720; 
    
    // Initialize smoothing buffer if needed
    if (!prevDistancesRef.current || prevDistancesRef.current.length !== NUM_RAYS + 1) {
        prevDistancesRef.current = new Float32Array(NUM_RAYS + 1).fill(visionRadius);
    }
    
    const currentDistances = prevDistancesRef.current;
    const LERP_FACTOR = 0.3; // Lower = smoother but more lag, Higher = snappier but more jitter

    // Calculate Target Distances for this frame
    const targetDistances = new Float32Array(NUM_RAYS + 1);

    for (let i = 0; i <= NUM_RAYS; i++) {
       const angle = (i / NUM_RAYS) * Math.PI * 2;
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
         // Bushes skipped

         if (dist !== null && dist < closestDist) {
           closestDist = dist;
         }
       }
       targetDistances[i] = closestDist;
    }

    // Apply Lerp and Construct Path
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(visionSourceScreenPos.x + targetDistances[0], visionSourceScreenPos.y); // Start point (approx)

    for (let i = 0; i <= NUM_RAYS; i++) {
        // LERP: Smooth transition from previous frame's distance to target distance
        const prev = currentDistances[i];
        const target = targetDistances[i];
        
        // Simple Lerp
        const nextDist = prev + (target - prev) * LERP_FACTOR;
        
        // Update Ref
        currentDistances[i] = nextDist;

        const angle = (i / NUM_RAYS) * Math.PI * 2;
        const x = visionSourceScreenPos.x + Math.cos(angle) * nextDist;
        const y = visionSourceScreenPos.y + Math.sin(angle) * nextDist;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }

    ctx.closePath();
    ctx.clip(); // <--- MAGIC: Only draw inside this region (The Light)
    
    // 4. Draw BRIGHT World inside Clip
    ctx.translate(-camX, -camY);
    
    // Bright Ground
    ctx.fillStyle = gameState.isNight ? COLORS.GROUND_NIGHT : COLORS.GROUND_DAY;
    ctx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);
    
    // Bright Static Objects (EXCLUDING BUSHES for Z-Sorting)
    const brightObjects = [gameState.cabin, ...(gameState.trees || []), ...(gameState.mushrooms || [])].filter(Boolean);
    const bushObjects = (gameState.bushes || []).filter(Boolean);

    // Draw non-bush statics (Ground level)
    brightObjects.forEach(obj => {
       drawEntity(ctx, obj, 
           obj.type === EntityType.TREE ? COLORS.TREE : 
           obj.type === EntityType.CABIN ? COLORS.CABIN : 
           COLORS.MUSHROOM
       );
    });

    // Draw Entities (Middle Layer)
    [...(gameState.deers || [])].forEach(deer => drawEntity(ctx, deer, COLORS.DEER));
    
    if (gameState.demon) {
       drawEntity(ctx, gameState.demon, gameState.isNight ? COLORS.DEMON_NIGHT : COLORS.DEMON_DAY, gameState.isNight);
    }
    
    // Only draw hunter if NOT in cabin
    if (gameState.hunter && !gameState.hunter.inCabin) {
        drawEntity(ctx, gameState.hunter, COLORS.HUNTER);
    }

    // Draw Bushes (Top Layer - Covers entities)
    bushObjects.forEach(obj => {
        const isMeInside = distance(targetEntity.pos, obj.pos) < obj.size;
        
        // If inside, use offscreen buffer to create a uniform transparent layer
        if (isMeInside && bushBufferRef.current && bufferCtx) {
             const bufferSize = Math.ceil(obj.size * 2.5);
             if (bushBufferRef.current.width !== bufferSize || bushBufferRef.current.height !== bufferSize) {
                 bushBufferRef.current.width = bufferSize;
                 bushBufferRef.current.height = bufferSize;
             }
             bufferCtx.clearRect(0, 0, bufferSize, bufferSize);
             bufferCtx.save();
             // Center in buffer
             bufferCtx.translate(bufferSize/2, bufferSize/2);
             
             // Draw Bush Particles to Buffer
             const parts = getBushParticles(obj);
             parts.leaves.forEach(p => {
                bufferCtx.beginPath(); 
                bufferCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2); 
                bufferCtx.fillStyle = p.color; 
                bufferCtx.fill();
             });
             parts.berries.forEach(p => {
                bufferCtx.beginPath(); 
                bufferCtx.arc(p.x, p.y, p.r, 0, Math.PI * 2); 
                bufferCtx.fillStyle = p.color; 
                bufferCtx.fill();
             });
             bufferCtx.restore();

             // Draw Buffer to Main Screen with Low Alpha
             ctx.save();
             ctx.globalAlpha = 0.3; // Very Transparent
             ctx.drawImage(bushBufferRef.current, obj.pos.x - bufferSize/2, obj.pos.y - bufferSize/2);
             ctx.restore();
        } 
        else {
             // Normal Draw (Direct)
             ctx.save();
             ctx.translate(obj.pos.x, obj.pos.y);
             const parts = getBushParticles(obj);
             parts.leaves.forEach(p => {
                 ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
             });
             parts.berries.forEach(p => {
                 ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fillStyle = p.color; ctx.fill();
             });
             ctx.restore();
        }
    });
    
    // Bullets (Top-most)
    ctx.fillStyle = '#fbbf24';
    (gameState.bullets || []).forEach(b => { 
        if(b && b.pos) {
            ctx.beginPath(); ctx.arc(b.pos.x, b.pos.y, 3, 0, Math.PI * 2); ctx.fill(); 
        }
    });

    ctx.restore();

    // 5. Overlay Effects (Demon Tracking)
    if (gameState.isNight && gameState.demon && gameState.demon.trackingActiveTime > 0) {
        ctx.save();
        ctx.translate(-camX, -camY); // Back to World Space
        ctx.translate(gameState.demon.pos.x, gameState.demon.pos.y);
        
        if (gameState.hunter && gameState.hunter.pos) {
            const dx = gameState.hunter.pos.x - gameState.demon.pos.x;
            const dy = gameState.hunter.pos.y - gameState.demon.pos.y;
            const angle = Math.atan2(dy, dx);
            
            ctx.rotate(angle);
            
            // Draw Red Arrow
            const dist = 45; // Distance from center
            ctx.fillStyle = '#ef4444'; 
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            
            ctx.beginPath();
            ctx.moveTo(dist, 0);
            ctx.lineTo(dist - 12, -6);
            ctx.lineTo(dist - 12, 6);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();
    }
    
  }, [gameState, cameraTarget]);

  return (
    <canvas 
      ref={canvasRef} 
      width={VIEWPORT_WIDTH * RENDER_SCALE} 
      height={VIEWPORT_HEIGHT * RENDER_SCALE}
      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
      className="rounded-lg shadow-2xl bg-black"
    />
  );
};

export default GameCanvas;
