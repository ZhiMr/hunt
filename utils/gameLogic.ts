import { Entity, EntityType, GameState, InputState, Vector2, GamePhase, PlayerInput, Player, GameMessage } from '../types';
import { 
  MAP_SIZE, MOVE_SPEED_HUNTER, MOVE_SPEED_DEMON, MOVE_SPEED_DEER, 
  SHOOT_COOLDOWN, BULLET_SPEED, DEMON_EAT_BONUS, MAX_BULLETS,
  DAY_DURATION_TICKS, SHOOT_PENALTY_SECONDS, DAY_DURATION_SECONDS,
  TREE_COLLISION_RATIO, FPS, CABIN_ENTER_DURATION, NIGHT_DURATION_SECONDS,
  DEMON_STUN_DURATION, DEMON_TRACKING_DURATION
} from '../constants';

// --- Helper Math ---
export const distance = (a: Vector2, b: Vector2) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
export const normalize = (v: Vector2): Vector2 => {
  const len = Math.sqrt(v.x * v.x + v.y * v.y);
  return len === 0 ? { x: 0, y: 0 } : { x: v.x / len, y: v.y / len };
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
export const checkCollision = (pos: Vector2, radius: number, obstacles: Entity[]): boolean => {
  // Map Boundaries
  if (pos.x < radius || pos.x > MAP_SIZE - radius || pos.y < radius || pos.y > MAP_SIZE - radius) {
    return true;
  }

  // Obstacles
  for (const obs of obstacles) {
    if (obs.type === EntityType.TREE) {
      // Square Collision for Trees
      const halfSize = obs.size * TREE_COLLISION_RATIO;
      if (checkRectCircleCollision(obs.pos, halfSize, pos, radius)) {
        return true;
      }
    } else {
      // Circle Collision for others (like Cabin)
      const dist = distance(pos, obs.pos);
      if (dist < radius + obs.size) {
        return true;
      }
    }
  }
  return false;
};

// --- Line of Sight (Raycasting) ---
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
        // Circle blockage
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
  obstacles: Entity[], 
  isNight: boolean
): PlayerInput => {
  const input: PlayerInput = { up: false, down: false, left: false, right: false, action: false };
  
  // If stunned, do nothing
  if (me.type === EntityType.DEMON && (me as any).stunTimer > 0) {
      return input;
  }

  const myPos = me.pos;
  let moveDir = { x: 0, y: 0 };
  
  // 1. Goal Seeking
  if (me.type === EntityType.DEMON) {
    // Demon Priority: Mushrooms > Survive
    // Find closest mushroom
    let closestMush: Entity | null = null;
    let minDist = Infinity;
    
    for (const mush of mushrooms) {
      const d = distance(myPos, mush.pos);
      if (d < minDist) {
        minDist = d;
        closestMush = mush;
      }
    }

    if (closestMush) {
       const toMush = normalize({ x: closestMush.pos.x - myPos.x, y: closestMush.pos.y - myPos.y });
       moveDir.x += toMush.x * 2.0;
       moveDir.y += toMush.y * 2.0;
       
       if (minDist < 10) input.action = true; // Eat
    }

    // Avoid Hunter if Day or if he is close
    const distToHunter = distance(myPos, opponent.pos);
    if (!isNight || distToHunter < 150) {
       const away = normalize({ x: myPos.x - opponent.pos.x, y: myPos.y - opponent.pos.y });
       const fearFactor = 300 / (distToHunter + 10);
       moveDir.x += away.x * fearFactor;
       moveDir.y += away.y * fearFactor;
    }

  } else {
    // Hunter Priority: Patrol -> Chase Demon
    const distToDemon = distance(myPos, opponent.pos);
    const canSeeDemon = isNight || distToDemon < 100; // Simplified vision for AI

    if (canSeeDemon && distToDemon < 400) {
      // Chase
      const toDemon = normalize({ x: opponent.pos.x - myPos.x, y: opponent.pos.y - myPos.y });
      moveDir.x += toDemon.x * 2.0;
      moveDir.y += toDemon.y * 2.0;
      
      // Shoot logic: roughly aligned and in range
      if (distToDemon < 250 && me.cooldown <= 0) {
          const angleToDemon = Math.atan2(toDemon.y, toDemon.x);
          const angleDiff = Math.abs(me.angle - angleToDemon);
          if (angleDiff < 0.5) input.action = true;
      }
    } else {
      // Patrol / Wander (using time to change direction would be better, but simple noise works)
      // Just move towards map center slightly to stay in bounds
      const toCenter = normalize({ x: MAP_SIZE/2 - myPos.x, y: MAP_SIZE/2 - myPos.y });
      moveDir.x += toCenter.x * 0.2;
      moveDir.y += toCenter.y * 0.2;
      
      // Random jitter
      moveDir.x += (Math.random() - 0.5) * 2;
      moveDir.y += (Math.random() - 0.5) * 2;
    }
  }

  // 2. Obstacle Avoidance (Repulsion)
  for (const obs of obstacles) {
    const dist = distance(myPos, obs.pos);
    const avoidRadius = obs.size + 40;
    if (dist < avoidRadius) {
       const away = normalize({ x: myPos.x - obs.pos.x, y: myPos.y - obs.pos.y });
       const weight = (avoidRadius - dist) / avoidRadius; // Stronger as we get closer
       moveDir.x += away.x * 5 * weight;
       moveDir.y += away.y * 5 * weight;
    }
  }

  // 3. Convert Vector to Input
  if (moveDir.x * moveDir.x + moveDir.y * moveDir.y > 0.1) {
    if (Math.abs(moveDir.x) > Math.abs(moveDir.y)) {
       if (moveDir.x > 0.1) input.right = true;
       else if (moveDir.x < -0.1) input.left = true;
       // Allow diagonal if strong enough
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

// --- State Update ---
export const updateGame = (state: GameState, hunterInput: PlayerInput, demonInput: PlayerInput, dt: number): GameState => {
  if (state.phase !== GamePhase.PLAYING) return state;

  const newState = { ...state };
  // Deep clone mutable entities to ensure React updates detect changes
  newState.hunter = { ...state.hunter, pos: { ...state.hunter.pos } };
  newState.demon = { ...state.demon, pos: { ...state.demon.pos } };
  
  // Update Message Timers
  newState.messages = newState.messages
      .map(m => ({ ...m, timeLeft: m.timeLeft - dt }))
      .filter(m => m.timeLeft > 0);

  const obstacles = [...state.trees, state.cabin];

  // Scale factor for frame-based logic (defaults were tuned for 60fps)
  const frameScale = dt * FPS;

  // Update Demon Tracking Timer
  if (newState.demon.trackingActiveTime > 0) {
      newState.demon.trackingActiveTime -= dt;
  }

  // 1. Time Progression
  if (!newState.isNight) {
    // Use real time seconds
    newState.timeOfDay += dt / DAY_DURATION_SECONDS;
    if (newState.timeOfDay >= 1) {
      newState.isNight = true;
      newState.timeOfDay = 1;
      newState.nightTimer = 0; // Initialize night timer
      newState.demon.canTrack = true; // Enable tracking for the night
      newState.messages = addMessage(newState.messages, "夜晚降临。快回到木屋躲避恶魔！");
    }
  } else {
    // Night Logic
    newState.nightTimer += dt;
    if (newState.nightTimer >= NIGHT_DURATION_SECONDS) {
        // Reset to Day
        newState.isNight = false;
        newState.timeOfDay = 0;
        newState.nightTimer = 0;
        newState.hunter.inCabin = false; // Kick out hunter
        newState.hunter.enterTimer = 0;
        newState.demon.stunTimer = 0; // Reset stun
        newState.demon.canTrack = false; // Reset tracking
        newState.messages = addMessage(newState.messages, "黎明到来，恶魔重新潜伏，蘑菇已刷新。");
        
        // Respawn Mushrooms (Scattered)
        const newMushrooms: Entity[] = [];
        const MIN_MUSHROOM_DIST = 100;

        for (let i = 0; i < 10; i++) {
           let pos = { x: 0, y: 0 };
           let valid = false;
           let attempts = 0;

           while(!valid && attempts < 20) {
             attempts++;
             pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
             
             // Check collisions with obstacles
             if (checkCollision(pos, 10, obstacles)) continue;
             
             // Check distance from other new mushrooms to ensure scatter
             let tooClose = false;
             for (const other of newMushrooms) {
                 if (distance(pos, other.pos) < MIN_MUSHROOM_DIST) {
                     tooClose = true;
                     break;
                 }
             }
             if (!tooClose) valid = true;
           }

           newMushrooms.push({
             id: `mush-respawn-${Date.now()}-${i}`,
             type: EntityType.MUSHROOM,
             pos,
             size: 8,
             angle: 0
           });
        }
        newState.mushrooms = newMushrooms;
    }
  }

  // 1.5 Cabin Logic
  if (newState.isNight && !newState.hunter.inCabin) {
     const doorPos = { 
         x: newState.cabin.pos.x, 
         y: newState.cabin.pos.y + newState.cabin.size + 5 // Door is at bottom edge
     };
     const distToDoor = distance(newState.hunter.pos, doorPos);
     
     // Specific requirement: Radius 30 for both enter and exit
     const INTERACTION_RADIUS = 30;
     
     if (distToDoor < INTERACTION_RADIUS) { 
         newState.hunter.enterTimer += dt;
         if (newState.hunter.enterTimer >= CABIN_ENTER_DURATION) {
             newState.hunter.inCabin = true;
             newState.messages = addMessage(newState.messages, "猎人躲进了木屋，暂时安全了！");
         }
     } else {
         // Immediate reset when leaving range
         newState.hunter.enterTimer = 0;
     }
  } else if (!newState.isNight) {
      // Reset timer if day
      newState.hunter.enterTimer = 0;
  }

  // 2. Hunter Movement (WASD / Input)
  if (!newState.hunter.inCabin) { // Can only move if not in cabin
    let moveH = { x: 0, y: 0 };
    if (hunterInput.up) moveH.y -= 1;
    if (hunterInput.down) moveH.y += 1;
    if (hunterInput.left) moveH.x -= 1;
    if (hunterInput.right) moveH.x += 1;
    
    if (moveH.x !== 0 || moveH.y !== 0) {
        moveH = normalize(moveH);
        const currentPos = { ...newState.hunter.pos };
        const speed = MOVE_SPEED_HUNTER * frameScale;

        // Try Move X
        const nextPosX = { x: currentPos.x + moveH.x * speed, y: currentPos.y };
        if (!checkCollision(nextPosX, newState.hunter.size, obstacles)) {
        newState.hunter.pos.x = nextPosX.x;
        }
        // Try Move Y (from potentially new X)
        const nextPosY = { x: newState.hunter.pos.x, y: currentPos.y + moveH.y * speed };
        if (!checkCollision(nextPosY, newState.hunter.size, obstacles)) {
        newState.hunter.pos.y = nextPosY.y;
        }
        // Update angle based on movement if moving
        newState.hunter.angle = Math.atan2(moveH.y, moveH.x);
    }
  }

  // 3. Demon Movement (Arrows / Input)
  if (newState.demon.stunTimer > 0) {
      // STUNNED Logic
      newState.demon.stunTimer -= dt;
      if (newState.demon.stunTimer < 0) newState.demon.stunTimer = 0;
  } else {
      let moveD = { x: 0, y: 0 };
      if (demonInput.up) moveD.y -= 1;
      if (demonInput.down) moveD.y += 1;
      if (demonInput.left) moveD.x -= 1;
      if (demonInput.right) moveD.x += 1;

      if (moveD.x !== 0 || moveD.y !== 0) {
        moveD = normalize(moveD);
        const baseSpeed = newState.isNight ? MOVE_SPEED_DEMON * 1.5 : MOVE_SPEED_DEER;
        const speed = baseSpeed * frameScale;
        
        const currentPos = { ...newState.demon.pos };
        
        // Try Move X
        const nextPosX = { x: currentPos.x + moveD.x * speed, y: currentPos.y };
        if (!checkCollision(nextPosX, newState.demon.size, obstacles)) {
          newState.demon.pos.x = nextPosX.x;
        }
        // Try Move Y
        const nextPosY = { x: newState.demon.pos.x, y: currentPos.y + moveD.y * speed };
        if (!checkCollision(nextPosY, newState.demon.size, obstacles)) {
          newState.demon.pos.y = nextPosY.y;
        }
        newState.demon.angle = Math.atan2(moveD.y, moveD.x);
      }
  }

  // 4. Hunter Actions (Shooting)
  if (newState.hunter.cooldown > 0) newState.hunter.cooldown -= frameScale;
  
  if (hunterInput.action && newState.hunter.cooldown <= 0 && !newState.hunter.inCabin) {
    // Shoot in facing direction
    const angle = newState.hunter.angle;
    const velocity = { x: Math.cos(angle) * BULLET_SPEED, y: Math.sin(angle) * BULLET_SPEED };
    newState.bullets.push({
      pos: { ...newState.hunter.pos },
      velocity,
      active: true
    });
    
    // Apply penalty
    if (!newState.isNight) {
      const penaltyPercent = SHOOT_PENALTY_SECONDS / DAY_DURATION_SECONDS;
      newState.timeOfDay = Math.min(1, newState.timeOfDay + penaltyPercent);
      if (newState.timeOfDay >= 1 && !newState.isNight) {
          newState.isNight = true;
          newState.nightTimer = 0;
          newState.demon.canTrack = true; // Enable tracking
          newState.messages = addMessage(newState.messages, "枪声加速了夜幕降临！");
      }
    }
    newState.hunter.cooldown = SHOOT_COOLDOWN;
  }

  // 5. Demon Actions (Eat Mushroom & Tracking)
  if (demonInput.action && newState.demon.stunTimer <= 0) {
    let actionUsed = false;

    // Tracking (Priority at Night)
    if (newState.isNight && newState.demon.canTrack) {
        newState.demon.canTrack = false;
        newState.demon.trackingActiveTime = DEMON_TRACKING_DURATION;
        newState.messages = addMessage(newState.messages, "恶魔感知到了猎人的方位！");
        actionUsed = true;
    }

    if (!actionUsed) {
        // Eating Mushroom
        const eatRange = 40;
        const mushroomIndex = newState.mushrooms.findIndex(m => distance(m.pos, newState.demon.pos) < eatRange);
        if (mushroomIndex !== -1) {
          newState.mushrooms.splice(mushroomIndex, 1);
          if (!newState.isNight) {
             newState.timeOfDay += DEMON_EAT_BONUS;
             newState.messages = addMessage(newState.messages, "咔嚓！好像有蘑菇被吃掉了...");
          }
        }
    }
  }

  // 6. Projectiles Physics & Collision
  newState.bullets = newState.bullets.map(b => ({
    ...b,
    pos: { x: b.pos.x + b.velocity.x * frameScale, y: b.pos.y + b.velocity.y * frameScale }
  })).filter(b => {
    // Out of bounds
    if (b.pos.x < 0 || b.pos.x > MAP_SIZE || b.pos.y < 0 || b.pos.y > MAP_SIZE) return false;
    
    // Hit Tree/Cabin
    for (const obs of obstacles) {
      if (obs.type === EntityType.TREE) {
        const halfSize = obs.size * TREE_COLLISION_RATIO;
        if (Math.abs(b.pos.x - obs.pos.x) < halfSize && 
            Math.abs(b.pos.y - obs.pos.y) < halfSize) {
          return false;
        }
      } else {
        if (distance(b.pos, obs.pos) < obs.size) return false;
      }
    }

    // Hit Demon
    if (distance(b.pos, newState.demon.pos) < newState.demon.size + 10) {
      if (newState.isNight) {
          // Night logic: Stun instead of kill
          newState.demon.stunTimer = DEMON_STUN_DURATION;
          newState.messages = addMessage(newState.messages, "恶魔被击晕了！");
          return false; // Remove bullet
      } else {
          // Day logic: Hunter Wins
          newState.phase = GamePhase.GAME_OVER_HUNTER_WINS;
          return false;
      }
    }
    return true;
  });

  // 7. Check Game Over
  if (newState.isNight && !newState.hunter.inCabin) {
    if (distance(newState.hunter.pos, newState.demon.pos) < 30 && newState.demon.stunTimer <= 0) {
      newState.phase = GamePhase.GAME_OVER_DEMON_WINS;
    }
  }

  // 8. AI Deer wandering
  newState.deers = newState.deers.map(deer => {
    const ai = deer.aiState || { moving: false, timer: 0 };
    let newAi = { ...ai };
    newAi.timer -= frameScale;

    if (newAi.timer <= 0) {
      newAi.moving = !newAi.moving;
      if (newAi.moving) {
        // Start Moving
        // Range: 2s to 5s (approx 120 to 300 frames)
        newAi.timer = Math.floor(Math.random() * 180) + 120;
        
        // 8-way direction: 0 to 7 * PI/4
        const dirIndex = Math.floor(Math.random() * 8);
        deer.angle = dirIndex * (Math.PI / 4);
      } else {
        // Start Idle
        // Range: 1s to 10s (60 to 600 frames)
        newAi.timer = Math.floor(Math.random() * 540) + 60;
        
        // Chance to change facing direction immediately upon stopping (50% chance)
        if (Math.random() < 0.5) {
             const turn = Math.random() < 0.5 ? 1 : -1;
             deer.angle += turn * (Math.PI / 4);
        }
      }
    }

    let nextPos = deer.pos;
    if (newAi.moving) {
       // Chance to change direction while moving
       if (Math.random() < 0.01) {
           // Turn 45 degrees left or right
           const turn = Math.random() < 0.5 ? 1 : -1;
           deer.angle += turn * (Math.PI / 4);
       }

       const speed = MOVE_SPEED_DEER * frameScale;
       nextPos = {
         x: deer.pos.x + Math.cos(deer.angle) * speed,
         y: deer.pos.y + Math.sin(deer.angle) * speed
       };
       if (checkCollision(nextPos, deer.size, obstacles)) {
         newAi.moving = false;
         newAi.timer = 60; 
         deer.angle += Math.PI; // Turn back
         nextPos = deer.pos;
       }
    } 
    
    return { ...deer, pos: nextPos, aiState: newAi };
  });

  return newState;
};