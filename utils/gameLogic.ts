
import { Entity, EntityType, GameState, InputState, Vector2, GamePhase, PlayerInput, Player, GameMessage, Hunter, Demon, DemonAIState } from '../types';
import { 
  MAP_SIZE, MOVE_SPEED_HUNTER, MOVE_SPEED_DEMON, MOVE_SPEED_DEER, 
  SHOOT_COOLDOWN, BULLET_SPEED, DEMON_EAT_BONUS, MAX_BULLETS,
  DAY_DURATION_TICKS, SHOOT_PENALTY_SECONDS, DAY_DURATION_SECONDS,
  TREE_COLLISION_RATIO, FPS, CABIN_ENTER_DURATION, NIGHT_DURATION_SECONDS,
  DEMON_STUN_DURATION, DEMON_TRACKING_DURATION, VISION_RADIUS_DAY, VISION_RADIUS_NIGHT
} from '../constants';

// --- Helper Math ---
export const distance = (a: Vector2, b: Vector2) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
export const normalize = (v: Vector2): Vector2 => {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
};
export const sub = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a: Vector2, b: Vector2): Vector2 => ({ x: a.x + b.x, y: a.y + b.y });
export const scale = (v: Vector2, s: number): Vector2 => ({ x: v.x * s, y: v.y * s });
export const dot = (a: Vector2, b: Vector2): number => a.x * b.x + a.y * b.y;

// --- Interpolation Helpers ---
export const lerp = (start: number, end: number, t: number) => {
  return start + (end - start) * t;
};

export const lerpVector = (start: Vector2, end: Vector2, t: number): Vector2 => {
  // If distance is too large (e.g. teleport), snap to end
  if (Math.abs(start.x - end.x) > 100 || Math.abs(start.y - end.y) > 100) return end;
  return {
    x: lerp(start.x, end.x, t),
    y: lerp(start.y, end.y, t)
  };
};

// Client-side interpolation logic
export const interpolateGameState = (current: GameState, target: GameState, dt: number): GameState => {
  // Interpolation factor. 
  // Higher = Snappier but more jitter if packet loss. 
  // Lower = Smoother but more latency (floaty).
  // 15.0 * dt roughly means covering distance quickly over frames.
  const t = Math.min(1, 15.0 * dt);

  const newState = { ...target }; // Copy non-positional data (phase, time, messages) directly from target

  // Interpolate Hunter
  newState.hunter = {
    ...target.hunter,
    pos: lerpVector(current.hunter.pos, target.hunter.pos, t)
  };

  // Interpolate Demon
  newState.demon = {
    ...target.demon,
    pos: lerpVector(current.demon.pos, target.demon.pos, t)
  };

  // Interpolate Deers
  // We match deers by ID to interpolate correctly
  newState.deers = target.deers.map(targetDeer => {
    const currentDeer = current.deers.find(d => d.id === targetDeer.id);
    if (!currentDeer) return targetDeer; // New deer, snap to pos
    return {
      ...targetDeer,
      pos: lerpVector(currentDeer.pos, targetDeer.pos, t),
      // Use target angle or interpolate it too if needed, but direct assignment is usually fine for rotation
      angle: targetDeer.angle 
    };
  });

  // Interpolate Bullets
  // Bullets are fast, snapping might be better, but lerping makes them look less choppy
  newState.bullets = target.bullets.map((targetBullet, index) => {
    // Try to find a corresponding bullet. 
    // Since bullets don't have unique IDs in current types, we assume array order roughly matches.
    // This is imperfect but better than nothing.
    const currentBullet = current.bullets[index];
    if (!currentBullet) return targetBullet;
    return {
      ...targetBullet,
      pos: lerpVector(currentBullet.pos, targetBullet.pos, t)
    };
  });
  
  // Bushes and Trees are static, simple assignment (handled by object spread above) is fine.

  return newState;
};

// Helper to add a message to state
const addMessage = (messages: GameMessage[], text: string): GameMessage[] => {
  return [{ id: Math.random(), text, timeLeft: 2.0 }, ...messages].slice(0, 5);
};

// Helper: Axis-Aligned Bounding Box (Square) vs Circle Collision
const checkRectCircleCollision = (rectCenter: Vector2, rectHalfSize: number, circleCenter: Vector2, circleRadius: number) => {
    const distX = Math.abs(circleCenter.x - rectCenter.x);
    const distY = Math.abs(circleCenter.y - rectCenter.y);

    if (distX > (rectHalfSize + circleRadius)) { return false; }
    if (distY > (rectHalfSize + circleRadius)) { return false; }

    if (distX <= (rectHalfSize)) { return true; }
    if (distY <= (rectHalfSize)) { return true; }

    const dx = distX - rectHalfSize;
    const dy = distY - rectHalfSize;
    return (dx * dx + dy * dy <= (circleRadius * circleRadius));
};

// --- Collision ---
export const checkCollision = (pos: Vector2, radius: number, obstacles: Entity[], includeBushes: boolean = false): boolean => {
  // Map Boundaries
  if (pos.x < radius || pos.x > MAP_SIZE - radius || pos.y < radius || pos.y > MAP_SIZE - radius) {
    return true;
  }

  // Obstacles
  for (const obs of obstacles) {
    // Bushes don't collide normally
    if (!includeBushes && obs.type === EntityType.BUSH) continue;

    if (obs.type === EntityType.TREE) {
      // Square Collision for Trees
      const halfSize = obs.size * TREE_COLLISION_RATIO;
      if (checkRectCircleCollision(obs.pos, halfSize, pos, radius)) {
        return true;
      }
    } else {
      // Circle Collision for others (like Cabin, Bushes)
      const dist = distance(pos, obs.pos);
      if (dist < radius + obs.size) {
        return true;
      }
    }
  }
  return false;
};

// --- Line of Sight (Raycasting) ---
// This is mainly used for server-side checks if needed, but primary vision is in GameCanvas.
// Updated to include bushes as blockers
export const hasLineOfSight = (p1: Vector2, p2: Vector2, obstacles: Entity[]): boolean => {
  const distTotal = distance(p1, p2);
  const dir = { x: (p2.x - p1.x) / distTotal, y: (p2.y - p1.y) / distTotal };
  
  // Raymarch in steps
  const stepSize = 10;
  let currentDist = 0;
  
  while (currentDist < distTotal) {
    currentDist += stepSize;
    if (currentDist >= distTotal) break; // Reached target

    const checkPos = { x: p1.x + dir.x * currentDist, y: p1.y + dir.y * currentDist };
    
    // Check against all blocking entities
    for (const obs of obstacles) {
      if (obs.type === EntityType.TREE) {
        // Square blockage
        const halfSize = obs.size * TREE_COLLISION_RATIO;
        if (Math.abs(checkPos.x - obs.pos.x) < halfSize && 
            Math.abs(checkPos.y - obs.pos.y) < halfSize) {
          return false; // Blocked
        }
      } else {
        // Circle blockage (Cabin, Bush)
        let obsRadius = obs.size; 
        if (distance(checkPos, obs.pos) < obsRadius) {
          return false; // Blocked
        }
      }
    }
  }
  return true;
};

// --- AI Logic ---
export const calculateBotInput = (
  me: Player, 
  opponent: Player, 
  mushrooms: Entity[],
  deers: Entity[], // Added deers for random target selection
  obstacles: Entity[], 
  bushes: Entity[], 
  isNight: boolean,
  dt: number
): PlayerInput => {
  const input: PlayerInput = { up: false, down: false, left: false, right: false, action: false };
  
  // If stunned, do nothing
  if (me.type === EntityType.DEMON && (me as any).stunTimer > 0) {
      return input;
  }

  const myPos = me.pos;
  let moveDir = { x: 0, y: 0 };
  
  // --- DEMON BOT ---
  if (me.type === EntityType.DEMON) {
    const demon = me as Demon;
    // Cast/Initialize AI state
    // We use 'as any' casting to attach flexible AI states to the generic Entity structure if not fully typed in all chains
    if (!demon.aiState || !('mode' in demon.aiState && 'lastPatrolPoint' in demon.aiState)) {
        demon.aiState = { 
            mode: 'PATROL', 
            targetPos: null, 
            timer: 0,
            lastPatrolPoint: null
        } as DemonAIState;
    }
    const ai = demon.aiState as DemonAIState;
    
    const distToHunter = distance(myPos, opponent.pos);
    
    // 1. NIGHT: Vision-Based Hunting
    if (isNight) {
        // -- Detection Logic --
        let canSeeHunter = false;
        
        // A. Active Tracking Skill (Automatic knowledge)
        if (demon.canTrack) {
             input.action = true; // Use skill
        }
        if (demon.trackingActiveTime > 0) {
            canSeeHunter = true; // Magic vision from skill
        } else {
            // B. Visual Detection
            if (distToHunter < VISION_RADIUS_NIGHT) {
                // Check if Hunter is inside a bush
                let inBush = false;
                for (const b of bushes) {
                    if (distance(opponent.pos, b.pos) < b.size) {
                        inBush = true;
                        break;
                    }
                }

                if (!inBush) {
                    // Check Line of Sight (Trees/Cabin)
                    if (hasLineOfSight(myPos, opponent.pos, obstacles)) {
                        canSeeHunter = true;
                    }
                }
            }
        }

        // -- State Machine --
        if (canSeeHunter) {
            ai.mode = 'CHASE';
            ai.targetPos = opponent.pos;
            ai.timer = 0;
        } else if (ai.mode === 'CHASE') {
            // Hunter lost -> Switch to Investigate
            ai.mode = 'INVESTIGATE';
            ai.timer = 2.0; // Spend 2 seconds checking the last known spot
            // targetPos remains at last known location
        } else if (ai.mode === 'INVESTIGATE') {
            ai.timer -= dt;
            if (ai.timer <= 0 || (ai.targetPos && distance(myPos, ai.targetPos) < 20)) {
                ai.mode = 'PATROL';
                ai.targetPos = null;
            }
        }

        // -- Patrol Logic (Exploration) --
        if (ai.mode === 'PATROL') {
            if (!ai.targetPos || distance(myPos, ai.targetPos) < 20) {
                // Pick a new target
                // Heuristic: Generate 5 random points, pick the one furthest from current pos AND last patrol point
                // This simulates "exploring new areas"
                let bestCandidate = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
                let maxScore = -1;

                for(let i=0; i<5; i++) {
                    const candidate = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
                    const dCurrent = distance(myPos, candidate);
                    const dLast = ai.lastPatrolPoint ? distance(ai.lastPatrolPoint, candidate) : 0;
                    
                    // Score = distance from me + distance from where I just was
                    const score = dCurrent + (dLast * 0.5); 
                    
                    if (score > maxScore) {
                        maxScore = score;
                        bestCandidate = candidate;
                    }
                }
                
                ai.lastPatrolPoint = ai.targetPos ? { ...ai.targetPos } : { ...myPos };
                ai.targetPos = bestCandidate;
            }
        }

        // -- Movement Execution --
        if (ai.targetPos) {
            const toTarget = normalize(sub(ai.targetPos, myPos));
            // Chase is faster, Patrol/Investigate slightly slower
            const speedMod = ai.mode === 'CHASE' ? 1.5 : 1.2; 
            moveDir = add(moveDir, scale(toTarget, speedMod));
        }

    } 
    // 2. DAY: Disguise & Survival
    else {
        // Keep existing Day logic (Mimic Sheep behavior)
        // PERCEPTION CHECK: Does Demon sense the Hunter?
        let detectsHunter = false;
        if (distToHunter < VISION_RADIUS_DAY) {
            if (distToHunter < 100 || hasLineOfSight(myPos, opponent.pos, obstacles)) {
                detectsHunter = true;
            }
        }

        // Reuse the generic ai structure for day mimicking, but adapt properties
        // We can temporarily use the same 'timer' field
        if (detectsHunter) {
            // MIMIC SHEEP: Stop/Go
            ai.timer -= dt * FPS; // Use frame scaling for timer consistency with old logic
            if (ai.timer <= 0) {
                 // Toggle moving/not moving via a temp flag or just using timer duration
                 // Let's use targetPos presence as "moving" state
                 if (ai.targetPos) {
                     // Was moving, now stop
                     ai.targetPos = null;
                     ai.timer = 60 + Math.random() * 240; // Stop for 1-4s
                 } else {
                     // Was stopped, now move
                     // Pick random angle
                     const angle = Math.random() * Math.PI * 2;
                     // Set a target pos far away in that direction to simulate movement vector
                     ai.targetPos = { x: myPos.x + Math.cos(angle) * 1000, y: myPos.y + Math.sin(angle) * 1000 };
                     ai.timer = 60 + Math.random() * 120; // Move for 1-2s
                 }
            }
            
            if (ai.targetPos) {
                const toTarget = normalize(sub(ai.targetPos, myPos));
                moveDir = toTarget;
            }
        } else {
             // FORAGE
             let closestMush: Entity | null = null;
             let minDist = Infinity;
             for (const mush of mushrooms) {
                 const d = distance(myPos, mush.pos);
                 if (d < minDist) { minDist = d; closestMush = mush; }
             }
             if (closestMush) {
                 const toMush = normalize(sub(closestMush.pos, myPos));
                 moveDir = add(moveDir, scale(toMush, 1.5));
                 if (minDist < 15) input.action = true; 
             } else {
                 // Wander if no mushrooms
                 ai.timer -= dt * FPS;
                 if (ai.timer <= 0) {
                     if (ai.targetPos) { ai.targetPos = null; ai.timer = 60 + Math.random() * 120; }
                     else {
                         const angle = Math.random() * Math.PI * 2;
                         ai.targetPos = { x: myPos.x + Math.cos(angle) * 1000, y: myPos.y + Math.sin(angle) * 1000 };
                         ai.timer = 60 + Math.random() * 120;
                     }
                 }
                 if (ai.targetPos) moveDir = normalize(sub(ai.targetPos, myPos));
             }
        }
    }
  } 
  // --- HUNTER BOT ---
  else {
    const hunter = me as unknown as Hunter;
    if (!hunter.aiState) {
        hunter.aiState = { 
            mode: 'IDLE', 
            targetPos: null, 
            waitTimer: 0,
            stuckTimer: 0,
            lastPos: { x: myPos.x, y: myPos.y }
        };
    }
    const ai = hunter.aiState;

    const distToDemon = distance(myPos, opponent.pos);
    
    // --- VISIBILITY CHECK ---
    let canSeeDemon = false;
    const visionRange = isNight ? VISION_RADIUS_NIGHT : VISION_RADIUS_DAY;

    // 1. Distance Check
    if (distToDemon < visionRange) {
        // 2. Bush Check
        let inBush = false;
        for (const b of bushes) {
            if (distance(opponent.pos, b.pos) < b.size) {
                inBush = true;
                break;
            }
        }
        
        // 3. Proximity & LOS
        if (!inBush || distToDemon < 80) {
             if (hasLineOfSight(myPos, opponent.pos, obstacles)) {
                 canSeeDemon = true;
             }
        }
    }

    // --- DETECTION LOGIC (Witnessing the crime) ---
    // The Hunter only "Knows" it's the demon if they see them eating a mushroom
    // or if the demon attacks them at night (handled by range check below)
    let witnessEating = false;
    if (canSeeDemon) {
        for (const m of mushrooms) {
             // Interaction distance for eating is ~40
             if (distance(opponent.pos, m.pos) < 40) {
                 witnessEating = true;
                 break;
             }
        }
    }

    // --- STUCK DETECTION ---
    // Detect if Hunter is trying to move but stuck (e.g. against a tree)
    // Only applies in moving states where targetPos is set
    if ((ai.mode === 'PATROL' || ai.mode === 'RETURN_CABIN') && ai.targetPos) {
        if (!ai.lastPos) ai.lastPos = { ...myPos };
        
        // If moved less than 5 pixels in this frame window (accumulated over updates)
        // Since this runs every frame, we use a small timer check
        // Ideally we compare against position X seconds ago, but here we check per frame accumulation
        if (distance(myPos, ai.lastPos) < 5) {
             ai.stuckTimer += dt;
        } else {
             ai.stuckTimer = 0;
             ai.lastPos = { ...myPos };
        }

        if (ai.stuckTimer > 2.0) { // Stuck for 2 seconds
             // Force retarget / Unstuck
             ai.mode = 'IDLE';
             ai.waitTimer = 0.5;
             ai.targetPos = null;
             ai.stuckTimer = 0;
        }
    } else {
        // Reset if not moving
        ai.stuckTimer = 0;
        ai.lastPos = { ...myPos };
    }

    // --- State Transitions ---

    // 1. NIGHT SURVIVAL (Top Priority)
    if (isNight && !hunter.inCabin) {
        ai.mode = 'RETURN_CABIN';
        const cabin = obstacles.find(o => o.type === EntityType.CABIN);
        if (cabin) {
            ai.targetPos = { x: cabin.pos.x, y: cabin.pos.y + cabin.size + 15 };
        }
    }
    // 2. CHASE (Only If Witnessed Eating)
    else if (witnessEating && !isNight) {
        ai.mode = 'CHASE';
        // Lock on to current pos
        ai.targetPos = opponent.pos;
    }
    // 3. CONTINUE CHASE (If previously locked and still visible)
    else if (ai.mode === 'CHASE' && !isNight) {
        // OMNISCIENT TRACKING in Chase mode
        // Directly update target to opponent position without prediction
        // This ensures the bot runs directly AT the player, solving "mimicking" feel of prediction
        ai.targetPos = opponent.pos;
    }
    // 4. PATROL (Default)
    else {
        // Reset from Chase/Return
        if (ai.mode === 'CHASE' || ai.mode === 'RETURN_CABIN') {
             ai.mode = 'IDLE';
             ai.waitTimer = 0.5;
             ai.targetPos = null;
        }

        if (ai.mode === 'IDLE') {
            ai.waitTimer -= dt;
            if (ai.waitTimer <= 0) {
                ai.mode = 'PATROL';
                // Check Mushrooms (70% chance)
                let picked = false;
                if (mushrooms.length > 0 && Math.random() < 0.7) {
                    // Try to pick a mushroom that is not immediately next to us
                    const validMushrooms = mushrooms.filter(m => distance(myPos, m.pos) > 100);
                    if (validMushrooms.length > 0) {
                        const rnd = validMushrooms[Math.floor(Math.random() * validMushrooms.length)];
                        ai.targetPos = { ...rnd.pos };
                        picked = true;
                    }
                }
                
                if (!picked) {
                     // Pick a random patrol point
                     let attempts = 0;
                     while(attempts < 10) {
                        const tx = Math.random() * MAP_SIZE;
                        const ty = Math.random() * MAP_SIZE;
                        const target = { x: tx, y: ty };
                        
                        // Ensure minimum travel distance of 300px to prevent staying in one area
                        if (distance(myPos, target) > 300) {
                            ai.targetPos = target;
                            picked = true;
                            break;
                        }
                        attempts++;
                     }
                     // Fallback
                     if (!picked) ai.targetPos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
                }
            }
        }
        
        if (ai.mode === 'PATROL') {
            if (ai.targetPos && distance(myPos, ai.targetPos) < 20) {
                ai.mode = 'IDLE';
                ai.waitTimer = 0.5 + Math.random() * 1.0; // Reduced wait time (0.5s - 1.5s)
                ai.targetPos = null;
            }
        }
    }

    // --- Execution ---
    
    if (ai.targetPos) {
        const toTarget = normalize(sub(ai.targetPos, myPos));
        let speedMod = 0.8;
        if (ai.mode === 'CHASE') speedMod = 1.0;
        if (ai.mode === 'RETURN_CABIN') speedMod = 2.5;

        moveDir = add(moveDir, scale(toTarget, speedMod));

        // CHASE specific: Shoot Logic
        if (ai.mode === 'CHASE') {
             // REMOVED: Back away logic. Now aggressively chases to ensure facing direction.
             
             // Shoot if in range (blind fire if chasing, as targetPos is locked)
             if (me.cooldown <= 0) {
                // Ensure we are somewhat aligned with target before firing to avoid shooting backward
                const targetAngle = Math.atan2(toTarget.y, toTarget.x);
                const myAngle = me.angle;
                let angleDiff = Math.abs(myAngle - targetAngle);
                if (angleDiff > Math.PI) angleDiff = 2 * Math.PI - angleDiff;
                
                if (angleDiff < 0.4) input.action = true;
             }
        }
        
        if (ai.mode === 'RETURN_CABIN' && distance(myPos, ai.targetPos) < 10) {
            moveDir = { x: 0, y: 0 };
        }
    }

    // --- PARANOIA: Randomly shoot at sheep/demon if patroling ---
    // Only if NOT chasing and NOT night and NOT returning to cabin
    if (ai.mode !== 'CHASE' && ai.mode !== 'RETURN_CABIN' && !isNight && me.cooldown <= 0) {
         // Low probability to shoot (e.g. 0.1% per frame, lowered from 0.5%)
         if (Math.random() < 0.001) {
             const potentialTargets = [...deers];
             if (canSeeDemon) potentialTargets.push(opponent);
             
             // Filter visible targets
             const visibleTargets = potentialTargets.filter(t => {
                 const d = distance(myPos, t.pos);
                 if (d > visionRange) return false;
                 // Don't shoot into bushes blindly unless very close
                 let inBush = false;
                 for (const b of bushes) { if (distance(t.pos, b.pos) < b.size) { inBush = true; break; } }
                 if (inBush && d > 80) return false;
                 
                 return hasLineOfSight(myPos, t.pos, obstacles);
             });

             if (visibleTargets.length > 0) {
                 const victim = visibleTargets[Math.floor(Math.random() * visibleTargets.length)];
                 const dx = victim.pos.x - myPos.x;
                 const dy = victim.pos.y - myPos.y;
                 const toVictim = normalize({x: dx, y: dy});
                 
                 // Override movement for this frame to face target (since angle depends on moveDir)
                 moveDir = toVictim; 
                 input.action = true; 
             }
         }
    }
  }

  // 3. Obstacle Avoidance (Weighted)
  for (const obs of obstacles) {
    if (obs.type === EntityType.BUSH) continue; 

    const dist = distance(myPos, obs.pos);
    const avoidRadius = obs.size + 30; 
    
    if (dist < avoidRadius) {
       const toObs = sub(obs.pos, myPos);
       const away = normalize(scale(toObs, -1));
       const weight = ((avoidRadius - dist) / avoidRadius) * 8.0; 
       moveDir = add(moveDir, scale(away, weight));
    }
  }

  // 4. Convert Vector to Input
  if (moveDir.x * moveDir.x + moveDir.y * moveDir.y > 0.1) {
    if (Math.abs(moveDir.x) > Math.abs(moveDir.y)) {
       if (moveDir.x > 0.1) input.right = true;
       else if (moveDir.x < -0.1) input.left = true;
       if (moveDir.y > 0.5) input.down = true;
       else if (moveDir.y < -0.5) input.up = true;
    } else {
       if (moveDir.y > 0.1) input.down = true;
       else if (moveDir.y < -0.1) input.up = true;
       if (moveDir.x > 0.5) input.right = true;
       else if (moveDir.x < -0.5) input.left = true;
    }
  }

  return input;
};

// --- Main Game Update Loop ---
export const updateGame = (state: GameState, hunterInput: PlayerInput, demonInput: PlayerInput, dt: number): GameState => {
  let newState = {
    ...state,
    hunter: { ...state.hunter },
    demon: { ...state.demon },
    // Shallow copy arrays to allow modification
    bullets: [...state.bullets],
    deers: [...state.deers],
    mushrooms: [...state.mushrooms],
    messages: [...state.messages],
    bushes: [...state.bushes]
  };

  const obstacles = [...state.trees, state.cabin];

  // --- 1. Time & Phase ---
  if (newState.phase === GamePhase.GAME_OVER_HUNTER_WINS || newState.phase === GamePhase.GAME_OVER_DEMON_WINS) {
      return newState;
  }

  // Messages TTL
  newState.messages = newState.messages.filter(m => {
      m.timeLeft -= dt;
      return m.timeLeft > 0;
  });

  // Day/Night Cycle
  if (newState.isNight) {
      newState.nightTimer += dt;
      if (newState.nightTimer >= NIGHT_DURATION_SECONDS) {
          // Loop Day Logic
          newState.isNight = false;
          newState.nightTimer = 0;
          newState.timeOfDay = 0;
          newState.hunter.inCabin = false; // Kick out
          newState.demon.isRevealed = false;
          newState.demon.canTrack = false;
          newState.messages = addMessage(newState.messages, "黎明到来，新的一天...");

          // Respawn Mushrooms (Fill up to 10)
          let attempts = 0;
          // Note: using state.bushes is safe here as obstacles includes logic for them in spawn check if we pass includeBushes=true
          while (newState.mushrooms.length < 10 && attempts < 50) {
             attempts++;
             const pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
             // Use obstacles + bushes for collision check to avoid spawning inside them
             if (!checkCollision(pos, 10, obstacles, true)) {
                 const tooClose = newState.mushrooms.some(m => distance(m.pos, pos) < 50);
                 if (!tooClose) {
                     newState.mushrooms.push({ 
                        id: `mush-respawn-${Date.now()}-${newState.mushrooms.length}`, 
                        type: EntityType.MUSHROOM, 
                        pos, 
                        size: 8, 
                        angle: 0 
                     });
                 }
             }
          }

          // Respawn Deer (Fill up to 25)
          attempts = 0;
          while (newState.deers.length < 25 && attempts < 50) {
             attempts++;
             const pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
             if (!checkCollision(pos, 15, obstacles)) {
                 newState.deers.push({
                  id: `deer-respawn-${Date.now()}-${newState.deers.length}`,
                  type: EntityType.DEER,
                  pos,
                  size: 12,
                  angle: Math.floor(Math.random() * 8) * (Math.PI / 4), // 8-way rotation
                  aiState: { moving: Math.random() > 0.5, timer: 60 }
                });
             }
          }
      }
  } else {
      newState.timeOfDay += dt / DAY_DURATION_SECONDS;
      if (newState.timeOfDay >= 1.0) {
          newState.isNight = true;
          newState.nightTimer = 0;
          newState.hunter.inCabin = false; 
          newState.messages = addMessage(newState.messages, "夜幕降临...");
          
          newState.demon.isRevealed = true;
          newState.demon.canTrack = true;
      }
  }

  // --- 2. Hunter ---
  // Movement
  if (!newState.hunter.inCabin) {
      let hMove = { x: 0, y: 0 };
      if (hunterInput.up) hMove.y -= 1;
      if (hunterInput.down) hMove.y += 1;
      if (hunterInput.left) hMove.x -= 1;
      if (hunterInput.right) hMove.x += 1;

      if (hMove.x !== 0 || hMove.y !== 0) {
          hMove = normalize(hMove);
          const moveDist = MOVE_SPEED_HUNTER * dt * FPS; 
          const nextPos = add(newState.hunter.pos, scale(hMove, moveDist));
          
          newState.hunter.angle = Math.atan2(hMove.y, hMove.x);

          if (!checkCollision(nextPos, newState.hunter.size, obstacles)) {
              newState.hunter.pos = nextPos;
          } else {
              // Sliding
               if (!checkCollision({x: nextPos.x, y: newState.hunter.pos.y}, newState.hunter.size, obstacles)) {
                   newState.hunter.pos.x = nextPos.x;
              } else if (!checkCollision({x: newState.hunter.pos.x, y: nextPos.y}, newState.hunter.size, obstacles)) {
                   newState.hunter.pos.y = nextPos.y;
              }
          }
      }
  }

  // Cabin Entry
  const distCabin = distance(newState.hunter.pos, newState.cabin.pos);
  const isHunterMoving = (hunterInput.up || hunterInput.down || hunterInput.left || hunterInput.right);
  
  // FIX: Allow entry even if moving slightly, as long as within range
  // Only enter if Night (was Day)
  if (newState.isNight && distCabin < newState.cabin.size + 40 && !newState.hunter.inCabin) {
      newState.hunter.enterTimer += dt;
      if (newState.hunter.enterTimer >= CABIN_ENTER_DURATION) {
          newState.hunter.inCabin = true;
          newState.hunter.enterTimer = 0;
          newState.messages = addMessage(newState.messages, "猎人已躲入木屋。");
      }
  } else {
      newState.hunter.enterTimer = Math.max(0, newState.hunter.enterTimer - dt * 2);
  }

  // Shooting
  if (newState.hunter.cooldown > 0) newState.hunter.cooldown -= dt * FPS;
  
  if (hunterInput.action && newState.hunter.cooldown <= 0 && !newState.hunter.inCabin) {
      newState.hunter.cooldown = SHOOT_COOLDOWN;
      const angle = newState.hunter.angle;
      const dir = { x: Math.cos(angle), y: Math.sin(angle) };
      const startPos = add(newState.hunter.pos, scale(dir, newState.hunter.size + 5));
      const velocity = scale(dir, BULLET_SPEED);
      
      newState.bullets.push({ pos: startPos, velocity, active: true });

      if (!newState.isNight) {
           const penalty = SHOOT_PENALTY_SECONDS / DAY_DURATION_SECONDS;
           // FIX: Allow time to hit 1.0 immediately for instant transition
           newState.timeOfDay = Math.min(1.0, newState.timeOfDay + penalty);
           newState.messages = addMessage(newState.messages, "开枪惩罚: 时间流逝");
      }
  }

  // --- 3. Demon ---
  if (newState.demon.stunTimer > 0) {
      newState.demon.stunTimer -= dt;
  } else {
      let dMove = { x: 0, y: 0 };
      if (demonInput.up) dMove.y -= 1;
      if (demonInput.down) dMove.y += 1;
      if (demonInput.left) dMove.x -= 1;
      if (demonInput.right) dMove.x += 1;

      if (dMove.x !== 0 || dMove.y !== 0) {
          dMove = normalize(dMove);
          
          // SPEED UPDATE: Day = Deer Speed, Night = Demon Speed * 1.3
          const currentSpeed = newState.isNight ? (MOVE_SPEED_DEMON * 1.3) : MOVE_SPEED_DEER;
          const moveDist = currentSpeed * dt * FPS;
          
          const nextPos = add(newState.demon.pos, scale(dMove, moveDist));
          newState.demon.angle = Math.atan2(dMove.y, dMove.x);

          if (!checkCollision(nextPos, newState.demon.size, obstacles)) {
              newState.demon.pos = nextPos;
          } else {
              if (!checkCollision({x: nextPos.x, y: newState.demon.pos.y}, newState.demon.size, obstacles)) {
                   newState.demon.pos.x = nextPos.x;
              } else if (!checkCollision({x: newState.demon.pos.x, y: nextPos.y}, newState.demon.size, obstacles)) {
                   newState.demon.pos.y = nextPos.y;
              }
          }
      }
  }

  // Demon Skills
  if (newState.isNight) {
      if (newState.demon.trackingActiveTime > 0) newState.demon.trackingActiveTime -= dt;
      // Prevent accidental trigger right after transition (e.g. holding key from eating)
      if (demonInput.action && newState.demon.canTrack && newState.nightTimer > 0.5) {
          newState.demon.canTrack = false;
          newState.demon.trackingActiveTime = DEMON_TRACKING_DURATION;
          newState.messages = addMessage(newState.messages, "恶魔正在感知...");
      }

      // Attack
      if (!newState.hunter.inCabin && newState.demon.stunTimer <= 0) {
          if (distance(newState.demon.pos, newState.hunter.pos) < (newState.demon.size + newState.hunter.size)) {
              newState.phase = GamePhase.GAME_OVER_DEMON_WINS;
              newState.messages = addMessage(newState.messages, "猎人被恶魔捕获！");
          }
      }
  } else {
      // Eat Mushroom (Require Interaction)
      if (demonInput.action) {
          const eatRange = 20;
          let ate = false;
          const initialCount = newState.mushrooms.length;
          newState.mushrooms = newState.mushrooms.filter(m => {
              if (ate) return true; // Already ate one this frame
              if (distance(newState.demon.pos, m.pos) < eatRange) {
                 ate = true;
                 return false;
              }
              return true;
          });

          if (newState.mushrooms.length < initialCount) {
              const bonus = DEMON_EAT_BONUS;
              // Allow time to hit 1.0 so night triggers immediately next frame
              newState.timeOfDay = Math.min(1.0, newState.timeOfDay + bonus);
              newState.messages = addMessage(newState.messages, "恶魔吞噬了蘑菇");
          }
      }
  }

  // --- 4. Deer ---
  newState.deers = newState.deers.map(deer => {
      // Copy deer
      const d = { ...deer, aiState: { ...deer.aiState } as any };
      
      d.aiState.timer -= dt * FPS;
      if (d.aiState.timer <= 0) {
          d.aiState.moving = !d.aiState.moving;
          d.aiState.timer = 60 + Math.random() * 120;
          if (d.aiState.moving) {
              // CHANGE: Snap to 8 directions (0, 45, 90, 135...)
              d.angle = Math.floor(Math.random() * 8) * (Math.PI / 4);
          }
      }

      if (d.aiState.moving) {
          const moveDist = MOVE_SPEED_DEER * dt * FPS;
          const dir = { x: Math.cos(d.angle), y: Math.sin(d.angle) };
          const nextPos = add(d.pos, scale(dir, moveDist));
          
          if (!checkCollision(nextPos, d.size, obstacles)) {
              d.pos = nextPos;
          } else {
              d.angle += Math.PI; // Bounce
          }
      }
      return d;
  });

  // --- 5. Bullets ---
  const deadDeerIds = new Set<string>();
  
  newState.bullets = newState.bullets.map(b => {
      const move = scale(b.velocity, dt * FPS);
      const nextPos = add(b.pos, move);
      
      if (nextPos.x < 0 || nextPos.x > MAP_SIZE || nextPos.y < 0 || nextPos.y > MAP_SIZE) {
          return { ...b, active: false };
      }

      if (checkCollision(nextPos, 2, obstacles)) return { ...b, active: false };

      // Hit Demon
      if (distance(nextPos, newState.demon.pos) < newState.demon.size + 5) {
           if (newState.isNight) {
               newState.demon.stunTimer = DEMON_STUN_DURATION;
               newState.messages = addMessage(newState.messages, "恶魔被击晕！");
           } else {
               newState.phase = GamePhase.GAME_OVER_HUNTER_WINS;
               newState.demon.isRevealed = true;
               newState.messages = addMessage(newState.messages, "恶魔被击杀！");
           }
           return { ...b, active: false };
      }

      // Hit Deer
      for (const deer of newState.deers) {
          if (distance(nextPos, deer.pos) < deer.size + 5) {
              deadDeerIds.add(deer.id);
              return { ...b, active: false };
          }
      }
      
      return { ...b, pos: nextPos };
  }).filter(b => b.active);

  if (deadDeerIds.size > 0) {
      newState.deers = newState.deers.filter(d => !deadDeerIds.has(d.id));
  }

  return newState;
};
