
import React, { useEffect, useRef, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import { MobileControls } from './components/MobileControls';
import { MainMenu } from './components/ui/MainMenu';
import { Lobby } from './components/ui/Lobby';
import { RulesModal } from './components/ui/RulesModal';
import { JoinModal } from './components/ui/JoinModal';
import { GameHUD } from './components/ui/GameHUD';
import { GameOverModal } from './components/ui/GameOverModal';
import { GameState, GamePhase, InputState, EntityType, Entity, GameMode, PlayerInput, OpponentMode } from './types';
import { MAP_SIZE, MAX_BULLETS, DAY_DURATION_SECONDS, CABIN_ENTER_DURATION, NIGHT_DURATION_SECONDS } from './constants';
import { updateGame, checkCollision, distance, calculateBotInput, interpolateGameState } from './utils/gameLogic';
import { LogOut, Signal, WifiOff } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

// --- Web Worker for Host Loop (Prevents throttling) ---
const WORKER_CODE = `
let intervalId = null;
self.onmessage = function(e) {
  if (e.data === 'START') {
    if (intervalId) clearInterval(intervalId);
    intervalId = setInterval(() => {
      self.postMessage('TICK');
    }, 1000 / 60);
  } else if (e.data === 'STOP') {
    if (intervalId) clearInterval(intervalId);
    intervalId = null;
  }
};
`;
const WORKER_BLOB = new Blob([WORKER_CODE], { type: 'application/javascript' });
const WORKER_URL = URL.createObjectURL(WORKER_BLOB);

// --- Production Network Config ---
const PEER_CONFIG = {
    debug: 1,
    secure: true, 
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.qq.com:3478' } 
        ],
        iceCandidatePoolSize: 10,
    }
};

// Helper to round entity for network transmission
const roundEntity = (e: any) => {
    if (!e || !e.pos) return e; 
    return {
        ...e,
        pos: { x: Math.round(e.pos.x), y: Math.round(e.pos.y) },
        velocity: e.velocity ? { x: Math.round(e.velocity.x), y: Math.round(e.velocity.y) } : undefined
    };
};

// --- Initial State Factory ---
const createInitialState = (): GameState => {
  const center = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
  const cabin: Entity = {
    id: 'cabin',
    type: EntityType.CABIN,
    pos: { ...center },
    size: 25,
    angle: 0
  };

  const obstacles: Entity[] = [cabin];
  const trees: Entity[] = [];
  const MAX_TREES = 40;
  const MIN_TREE_GAP = 60; 
  let attempts = 0;

  while (trees.length < MAX_TREES && attempts < 1000) {
    attempts++;
    const size = 20 + Math.random() * 15;
    const pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
    let valid = true;
    for (const tree of trees) {
      if (distance(pos, tree.pos) < (size + tree.size + MIN_TREE_GAP)) {
        valid = false;
        break;
      }
    }
    if (distance(pos, cabin.pos) < 150) valid = false;

    if (valid) {
      const newTree = { id: `tree-${trees.length}`, type: EntityType.TREE, pos, size, angle: 0 };
      trees.push(newTree);
      obstacles.push(newTree);
    }
  }

  const deers: Entity[] = [];
  for (let i = 0; i < 15; i++) {
    let pos = { x: 0, y: 0 };
    let valid = false;
    let spawnAttempts = 0;
    while(!valid && spawnAttempts < 50) {
        spawnAttempts++;
        pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
        if (!checkCollision(pos, 12, obstacles)) valid = true;
    }
    deers.push({
      id: `deer-${i}`,
      type: EntityType.DEER,
      pos: valid ? pos : { x: 50, y: 50 },
      size: 12,
      angle: Math.floor(Math.random() * 8) * (Math.PI / 4),
      aiState: { moving: Math.random() > 0.5, timer: Math.floor(Math.random() * 100) + 50 }
    });
  }

  const mushrooms: Entity[] = [];
  const MIN_MUSHROOM_DIST = 100;
  for (let i = 0; i < 10; i++) {
    let pos = { x: 0, y: 0 };
    let valid = false;
    let spawnAttempts = 0;
    while(!valid && spawnAttempts < 20) {
      spawnAttempts++;
      pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
      if (checkCollision(pos, 10, obstacles)) continue;
      let tooClose = false;
      for (const other of mushrooms) {
          if (distance(pos, other.pos) < MIN_MUSHROOM_DIST) {
              tooClose = true;
              break;
          }
      }
      if (!tooClose) valid = true;
    }
    mushrooms.push({ id: `mush-${i}`, type: EntityType.MUSHROOM, pos, size: 8, angle: 0 });
  }

  return {
    phase: GamePhase.MENU,
    timeOfDay: 0,
    isNight: false,
    nightTimer: 0,
    hunter: {
      id: 'hunter',
      type: EntityType.HUNTER,
      pos: { x: center.x, y: center.y + 80 }, 
      velocity: { x: 0, y: 0 },
      size: 14,
      angle: 0,
      bullets: MAX_BULLETS,
      cooldown: 0,
      inCabin: false,
      enterTimer: 0
    },
    demon: {
      id: 'demon',
      type: EntityType.DEMON,
      pos: { x: 100, y: 100 },
      velocity: { x: 0, y: 0 },
      size: 14,
      angle: 0,
      energy: 0,
      isRevealed: false,
      cooldown: 0,
      stunTimer: 0,
      trackingActiveTime: 0,
      canTrack: false
    },
    deers,
    trees,
    mushrooms,
    bullets: [],
    cabin,
    mapWidth: MAP_SIZE,
    mapHeight: MAP_SIZE,
    lastShotTime: 0,
    messages: [{ id: Date.now(), text: "欢迎来到森林。猎人 vs 恶魔。", timeLeft: 3.0 }]
  };
};

const generateRoomId = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; 
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(createInitialState());
  const targetGameStateRef = useRef<GameState | null>(null); // For client interpolation
  
  // Lobby State
  const [roomId, setRoomId] = useState<string>("");
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.SINGLE_PLAYER);
  const [isCopied, setIsCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [showJoinPanel, setShowJoinPanel] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  
  // New Role & Opponent State
  const [myRole, setMyRole] = useState<EntityType>(EntityType.HUNTER);
  const [opponentMode, setOpponentMode] = useState<OpponentMode>('WAITING');
  const [joinError, setJoinError] = useState<string>("");
  const [latency, setLatency] = useState<number | null>(null);
  
  // Network Health
  const [isLagging, setIsLagging] = useState(false);
  const lastPacketTimeRef = useRef<number>(0);
  
  const gameStartedRef = useRef<boolean>(false); 
  
  const packetCountRef = useRef<number>(0);
  const [lastError, setLastError] = useState<string>("");

  // Networking Refs
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const isHostRef = useRef<boolean>(true);
  const networkTickRef = useRef<number>(0);
  const inputTickRef = useRef<number>(0);
  const pingIntervalRef = useRef<number | null>(null);
  
  // Worker Ref for Host Loop
  const workerRef = useRef<Worker | null>(null);

  // Input Refs
  const inputRef = useRef<InputState>({
    w: false, a: false, s: false, d: false, space: false,
    up: false, left: false, down: false, right: false, enter: false
  });
  const remoteInputRef = useRef<PlayerInput>({
    up: false, down: false, left: false, right: false, action: false
  });

  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Init Worker
  useEffect(() => {
    workerRef.current = new Worker(WORKER_URL);
    return () => {
      workerRef.current?.terminate();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      // Only treat as mobile if touch is supported AND screen is small (less than 1024px)
      // This prevents touch-enabled laptops or large tablets from showing on-screen controls
      const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
      const isSmallScreen = window.innerWidth < 1024;
      setIsMobile(isTouch && isSmallScreen);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
      if (gameMode === GameMode.ONLINE_HOST && connRef.current && opponentMode === 'CONNECTED') {
          try {
             connRef.current.send({ type: 'LOBBY_UPDATE', hostRole: myRole });
          } catch(e) { console.error("Lobby update failed", e); }
      }
  }, [myRole, gameMode, opponentMode]);

  useEffect(() => {
    if ((gameMode === GameMode.ONLINE_HOST || gameMode === GameMode.ONLINE_CLIENT) && opponentMode === 'CONNECTED') {
        pingIntervalRef.current = window.setInterval(() => {
            if (connRef.current && connRef.current.open) {
                try {
                    connRef.current.send({ type: 'PING', timestamp: Date.now() });
                } catch (e) { /* ignore */ }
            }
        }, 1000);
    } else {
        if (pingIntervalRef.current) {
            clearInterval(pingIntervalRef.current);
            pingIntervalRef.current = null;
        }
        setLatency(null);
        setIsLagging(false);
    }
    return () => {
        if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    }
  }, [gameMode, opponentMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) e.preventDefault();
      switch (e.key.toLowerCase()) {
        case 'w': inputRef.current.w = true; break;
        case 'a': inputRef.current.a = true; break;
        case 's': inputRef.current.s = true; break;
        case 'd': inputRef.current.d = true; break;
        case ' ': inputRef.current.space = true; break;
        case 'arrowup': inputRef.current.up = true; break;
        case 'arrowleft': inputRef.current.left = true; break;
        case 'arrowdown': inputRef.current.down = true; break;
        case 'arrowright': inputRef.current.right = true; break;
        case 'enter': inputRef.current.enter = true; break;
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.key.toLowerCase()) {
        case 'w': inputRef.current.w = false; break;
        case 'a': inputRef.current.a = false; break;
        case 's': inputRef.current.s = false; break;
        case 'd': inputRef.current.d = false; break;
        case ' ': inputRef.current.space = false; break;
        case 'arrowup': inputRef.current.up = false; break;
        case 'arrowleft': inputRef.current.left = false; break;
        case 'arrowdown': inputRef.current.down = false; break;
        case 'arrowright': inputRef.current.right = false; break;
        case 'enter': inputRef.current.enter = false; break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const initializeHost = () => {
    if (peerRef.current) { peerRef.current.destroy(); peerRef.current = null; }
    if (connRef.current) { connRef.current.close(); connRef.current = null; }

    setOpponentMode('WAITING');
    setLatency(null);
    setIsLagging(false);
    gameStartedRef.current = false;
    packetCountRef.current = 0;
    setLastError("");
    
    const id = generateRoomId();
    setRoomId(id);
    const peer = new Peer(id, PEER_CONFIG);
    
    peer.on('open', (id) => {
      if (peer !== peerRef.current) return;
      console.log('Host ID: ' + id);
      setGameMode(GameMode.ONLINE_HOST);
      isHostRef.current = true;
    });
    
    peer.on('error', (err) => {
        console.error("Host Error:", err);
        setLastError(`HostErr: ${err.type}`);
        setJoinError("创建失败");
        window.alert(`错误: ${err.type}`);
        setGameState(prev => ({...prev, phase: GamePhase.MENU}));
    });

    peer.on('connection', (conn) => {
      if (peer !== peerRef.current) return;
      conn.on('open', () => {
        if (peer !== peerRef.current) return;
        setOpponentMode('CONNECTED');
        connRef.current = conn;
        lastPacketTimeRef.current = Date.now();
        try { conn.send({ type: 'LOBBY_UPDATE', hostRole: myRole }); } catch(e){}
      });
      conn.on('data', (data: any) => {
        lastPacketTimeRef.current = Date.now();
        if (data.type === 'INPUT_UPDATE') remoteInputRef.current = data.input;
        else if (data.type === 'PONG') setLatency(Date.now() - data.timestamp);
      });
      conn.on('close', () => {
        if (conn === connRef.current) {
             setOpponentMode('WAITING');
             connRef.current = null;
             setLatency(null);
             gameStartedRef.current = false;
        }
      });
    });
    peerRef.current = peer;
  };

  const joinGame = (code: string) => {
    setJoinError("");
    setIsConnecting(true);
    if (peerRef.current) peerRef.current.destroy();

    const peer = new Peer(generateRoomId(), PEER_CONFIG);
    
    peer.on('error', (err: any) => {
        console.error("Client Error:", err);
        setLastError(`ClientErr: ${err.type}`);
        setIsConnecting(false);
        if (err.type === 'peer-unavailable') setJoinError("房间不存在");
        else setJoinError(`连接错误: ${err.type}`);
    });

    peer.on('open', (id) => {
      if (peer !== peerRef.current) return;
      const conn = peer.connect(code, { reliable: true });
      
      const timeout = setTimeout(() => {
          if (peerRef.current === peer && opponentMode !== 'CONNECTED') {
              setJoinError("连接超时");
              setIsConnecting(false);
              conn.close();
          }
      }, 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        if (peer !== peerRef.current) return;
        console.log("Connected to: " + code);
        setJoinError(""); 
        setIsConnecting(false);
        setShowJoinPanel(false); 
        setRoomId(code);
        setGameMode(GameMode.ONLINE_CLIENT);
        isHostRef.current = false;
        lastPacketTimeRef.current = Date.now();
        setIsLagging(false);
        gameStartedRef.current = false; 
        packetCountRef.current = 0;
        setLastError("");
        setMyRole(EntityType.DEMON); 
        setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
        setOpponentMode('CONNECTED');
        connRef.current = conn;
      });

      conn.on('data', (data: any) => {
        try {
            lastPacketTimeRef.current = Date.now();
            if (isLagging) setIsLagging(false);
            packetCountRef.current += 1;

            if (data.type === 'LOBBY_UPDATE') {
                setMyRole(data.hostRole === EntityType.HUNTER ? EntityType.DEMON : EntityType.HUNTER);
            } else if (data.type === 'START_GAME') {
                gameStartedRef.current = true;
                if (data.clientRole) setMyRole(data.clientRole);
                if (data.initialState) {
                    setGameState(data.initialState);
                    targetGameStateRef.current = data.initialState; // Initialize target
                    lastTimeRef.current = 0; 
                }
            } else if (data.type === 'STATE_UPDATE') {
                if (!gameStartedRef.current) return;
                
                // Construct the full state from the update (merging static assets if needed)
                // BUG FIX: Strictly use targetGameStateRef.current. If missing, wait for START_GAME.
                // Do NOT fallback to 'gameState' (local state) as it has different random seed (trees).
                const baseState = targetGameStateRef.current;
                
                if (!baseState) return; // Ignore updates until START_GAME initializes the map
                
                const fullStateUpdate = {
                    ...baseState, 
                    ...data.state,
                    // Ensure critical arrays are present.
                    // If Host sends sparse updates for trees (which it likely does to save bandwidth),
                    // we MUST preserve the trees from the Base State (which came from START_GAME).
                    trees: (data.state.trees && data.state.trees.length > 0) ? data.state.trees : (baseState.trees || []),
                    cabin: data.state.cabin ? data.state.cabin : (baseState.cabin || createInitialState().cabin),
                    mushrooms: data.state.mushrooms || baseState.mushrooms || [],
                    deers: data.state.deers || baseState.deers || [],
                    bullets: data.state.bullets || baseState.bullets || [],
                };
                
                // Update the "Target" state for interpolation loop to chase
                targetGameStateRef.current = fullStateUpdate;

            } else if (data.type === 'PING') {
                try { conn.send({ type: 'PONG', timestamp: data.timestamp }); } catch(e){}
            } else if (data.type === 'PONG') {
                setLatency(Date.now() - data.timestamp);
            }
        } catch (err: any) {
            console.error("Packet Error", err);
            setLastError(`Pkt: ${err.message}`);
        }
      });
      
      conn.on('close', () => {
          clearTimeout(timeout);
          window.alert("Host disconnected");
          gameStartedRef.current = false;
          setLastError("Host Lost");
          setGameState(prev => ({...prev, phase: GamePhase.MENU}));
      });
      
      conn.on('error', (err) => {
          clearTimeout(timeout);
          setLastError(`Conn: ${err.type}`);
          setIsConnecting(false);
      });
    });
    peerRef.current = peer;
  };

  const startGame = () => {
    if (gameMode === GameMode.ONLINE_CLIENT) return;
    if (gameMode === GameMode.ONLINE_HOST) {
        if (!connRef.current || opponentMode !== 'CONNECTED') return;
    }

    const newState = createInitialState();
    const obstacles = [...newState.trees, newState.cabin];
    let valid = false;
    let spawnPos = { x: 100, y: 100 };
    let attempts = 0;
    while (!valid && attempts < 100) {
      attempts++;
      const candidate = { x: Math.random() * (MAP_SIZE - 100) + 50, y: Math.random() * (MAP_SIZE - 100) + 50 };
      if (distance(candidate, newState.hunter.pos) > 300 && !checkCollision(candidate, newState.demon.size, obstacles)) {
        valid = true;
        spawnPos = candidate;
      }
    }
    newState.demon.pos = spawnPos;
    newState.phase = GamePhase.PLAYING;

    if (connRef.current && isHostRef.current) {
        try {
            const clientRole = myRole === EntityType.HUNTER ? EntityType.DEMON : EntityType.HUNTER;
            const fullState = JSON.parse(JSON.stringify(newState));
            connRef.current.send({ type: 'START_GAME', clientRole, initialState: fullState });
            gameStartedRef.current = true;
        } catch(e) { console.error("Start Error", e); }
    }

    setGameState(newState);
    lastTimeRef.current = 0;
  };

  const loop = (timestamp: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const deltaTime = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;
    const safeDelta = Math.min(deltaTime, 0.1); 

    if (gameMode === GameMode.ONLINE_CLIENT) {
        if (opponentMode === 'CONNECTED') {
            if (Date.now() - lastPacketTimeRef.current > 2500 && !isLagging) setIsLagging(true);
        }

        // Send Input
        inputTickRef.current += deltaTime;
        if (inputTickRef.current >= 0.033) { 
            if (connRef.current && connRef.current.open) {
                const myInput = {
                    up: inputRef.current.up || inputRef.current.w,
                    down: inputRef.current.down || inputRef.current.s,
                    left: inputRef.current.left || inputRef.current.a,
                    right: inputRef.current.right || inputRef.current.d,
                    action: inputRef.current.enter || inputRef.current.space
                };
                try { connRef.current.send({ type: 'INPUT_UPDATE', input: myInput }); } catch(e) {}
            }
            inputTickRef.current = 0;
        }

        // Client-side Interpolation Loop
        if (gameStartedRef.current && targetGameStateRef.current) {
            setGameState(prev => {
                // If phase changed (e.g. Game Over), switch immediately
                if (targetGameStateRef.current!.phase !== prev.phase) {
                    return targetGameStateRef.current!;
                }
                // Otherwise, interpolate positions
                return interpolateGameState(prev, targetGameStateRef.current!, safeDelta);
            });
        }
        
        // Client always uses RAF for smooth rendering/interpolation
        requestRef.current = requestAnimationFrame(loop);
        return; 
    }

    setGameState(prev => {
      if (prev.phase !== GamePhase.PLAYING) return prev;

      let hunterIn = { up: false, down: false, left: false, right: false, action: false };
      let demonIn = { up: false, down: false, left: false, right: false, action: false };
      const localInput = {
          up: inputRef.current.w || inputRef.current.up,
          down: inputRef.current.s || inputRef.current.down,
          left: inputRef.current.a || inputRef.current.left,
          right: inputRef.current.d || inputRef.current.right,
          action: inputRef.current.space || inputRef.current.enter
      };

      if (myRole === EntityType.HUNTER) hunterIn = localInput; else demonIn = localInput;

      if (gameMode === GameMode.ONLINE_HOST) {
          if (myRole === EntityType.HUNTER) demonIn = remoteInputRef.current; else hunterIn = remoteInputRef.current;
      } else if (opponentMode === 'COMPUTER') {
             const obstacles = [...prev.trees, prev.cabin];
             if (myRole === EntityType.HUNTER) demonIn = calculateBotInput(prev.demon, prev.hunter, prev.mushrooms, obstacles, prev.isNight, safeDelta);
             else hunterIn = calculateBotInput(prev.hunter, prev.demon, prev.mushrooms, obstacles, prev.isNight, safeDelta);
      }

      let nextState;
      try { nextState = updateGame(prev, hunterIn, demonIn, safeDelta); } catch (err) { return prev; }

      if (gameMode === GameMode.ONLINE_HOST && connRef.current) {
          networkTickRef.current += deltaTime;
          if (networkTickRef.current >= 0.05) { 
              try {
                  if (connRef.current.open) {
                      const dynamicState = {
                          ...nextState,
                          hunter: roundEntity(nextState.hunter),
                          demon: roundEntity(nextState.demon),
                          deers: nextState.deers.map(roundEntity),
                          bullets: nextState.bullets.map(b => ({...b, pos: {x: Math.round(b.pos.x), y: Math.round(b.pos.y)}})),
                          mushrooms: nextState.mushrooms
                      };
                      const { trees, cabin, ...optimizedState } = dynamicState;
                      connRef.current.send({ type: 'STATE_UPDATE', state: optimizedState });
                  }
              } catch(e) {}
              networkTickRef.current = 0;
          }
      }
      return nextState;
    });
    
    // Recursive call ONLY if not HOST (Host is driven by Worker)
    if (gameMode !== GameMode.ONLINE_HOST) {
        requestRef.current = requestAnimationFrame(loop);
    }
  };

  useEffect(() => {
    // If ONLINE_HOST, use Web Worker to drive the loop to prevent background throttling
    if (gameMode === GameMode.ONLINE_HOST) {
        if (workerRef.current) {
            workerRef.current.onmessage = (e) => {
                if (e.data === 'TICK') {
                    // Drive the loop manually
                    loop(performance.now());
                }
            };
            workerRef.current.postMessage('START');
        }
        return () => {
            workerRef.current?.postMessage('STOP');
        };
    } else {
        // Single Player or Client uses RAF
        workerRef.current?.postMessage('STOP');
        requestRef.current = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(requestRef.current!);
    }
  }, [gameMode, myRole, opponentMode]); 

  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const cameraTarget = myRole === EntityType.HUNTER ? 'HUNTER' : 'DEMON';

  return (
    <div className={`h-[100dvh] w-full bg-neutral-900 text-stone-200 flex flex-col items-center font-mono overflow-hidden relative`}>
      {showRules && <RulesModal onClose={() => setShowRules(false)} />}
      {showJoinPanel && <JoinModal onClose={() => setShowJoinPanel(false)} onJoin={joinGame} isConnecting={isConnecting} error={joinError} />}
      
      {isMobile && gameState.phase === GamePhase.PLAYING && (
         <MobileControls 
             inputRef={inputRef} 
             onExit={gameMode === GameMode.SINGLE_PLAYER ? () => setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY })) : undefined}
         />
      )}

      {/* DIAGNOSTIC OVERLAY */}
      {gameMode === GameMode.ONLINE_CLIENT && gameState.phase === GamePhase.PLAYING && (
          <div className="absolute top-16 right-4 z-50 bg-black/60 p-2 rounded text-[10px] font-mono border border-stone-600 flex flex-col gap-1 w-32 backdrop-blur-sm pointer-events-none select-none">
             <div className="flex justify-between border-b border-stone-600 pb-1 mb-1">
                 <span className="font-bold text-blue-400">DEBUG</span>
                 <span>{roomId}</span>
             </div>
             <div className="flex justify-between"><span>Pkt:</span><span className="text-green-400">{packetCountRef.current}</span></div>
             <div className="flex justify-between"><span>Lat:</span><span className={latency && latency > 200 ? "text-red-500" : "text-stone-300"}>{latency ?? '-'}ms</span></div>
             {lastError && <div className="mt-1 pt-1 border-t border-red-900 text-red-400 break-words leading-tight">! {lastError.substring(0, 30)}</div>}
          </div>
      )}

      {/* Exit Button */}
      {gameState.phase === GamePhase.PLAYING && gameMode === GameMode.SINGLE_PLAYER && !isMobile && (
        <button 
            onClick={() => setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }))}
            className="fixed top-4 left-4 z-50 bg-neutral-800/80 hover:bg-red-900/90 text-stone-400 hover:text-white border border-neutral-600 hover:border-red-500 rounded-lg px-3 py-2 flex items-center gap-2 transition-all shadow-xl backdrop-blur-sm font-bold text-sm"
        >
            <LogOut size={16} /> <span className="hidden md:inline">退出</span>
        </button>
      )}

      {/* Lag Indicator */}
      {gameState.phase === GamePhase.PLAYING && (gameMode === GameMode.ONLINE_HOST || gameMode === GameMode.ONLINE_CLIENT) && (
          <div className="absolute top-4 left-4 z-50 flex flex-col items-start gap-1 pointer-events-none">
               {latency !== null && (
                   <div className="bg-black/40 px-2 py-1 rounded border border-white/10 flex items-center gap-2 backdrop-blur-sm">
                        <Signal size={14} className={isLagging ? "text-red-500 animate-pulse" : latency < 100 ? "text-green-500" : latency < 200 ? "text-yellow-500" : "text-red-500"} />
                        <span className="text-[10px] font-mono text-stone-300">{isLagging ? '---' : `${latency}ms`}</span>
                   </div>
               )}
               {isLagging && (
                   <div className="bg-red-900/80 px-2 py-1 rounded border border-red-500 flex items-center gap-2 backdrop-blur-sm animate-pulse">
                        <WifiOff size={14} className="text-red-200" />
                        <span className="text-[10px] font-bold text-red-100">连接不稳定</span>
                   </div>
               )}
          </div>
      )}

      {/* Game HUD */}
      {gameState.phase === GamePhase.PLAYING && (
          <GameHUD gameState={gameState} cameraTarget={cameraTarget} />
      )}

      {/* Main Content Area */}
      <div className={`w-full h-full flex items-center justify-center overflow-y-auto ${gameState.phase !== GamePhase.PLAYING ? 'py-8' : ''}`}>
        {(gameState.phase === GamePhase.MENU || gameState.phase === GamePhase.LOBBY) && (
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center min-h-full">
                {gameState.phase === GamePhase.MENU && (
                    <MainMenu 
                        onSinglePlayer={() => {
                            setGameMode(GameMode.SINGLE_PLAYER);
                            setMyRole(EntityType.HUNTER);
                            setOpponentMode('WAITING');
                            setGameState(prev => ({...prev, phase: GamePhase.LOBBY}));
                        }}
                        onHostGame={() => {
                            setGameMode(GameMode.ONLINE_HOST); 
                            setOpponentMode('WAITING');
                            setLatency(null);
                            initializeHost();
                            setMyRole(EntityType.HUNTER);
                            setGameState(prev => ({...prev, phase: GamePhase.LOBBY}));
                        }}
                        onJoinGame={() => {
                            setJoinError("");
                            setShowJoinPanel(true);
                        }}
                    />
                )}
                {gameState.phase === GamePhase.LOBBY && (
                    <Lobby 
                        gameMode={gameMode}
                        roomId={roomId}
                        myRole={myRole}
                        opponentMode={opponentMode}
                        latency={latency}
                        isCopied={isCopied}
                        onCopy={handleCopy}
                        onShowRules={() => setShowRules(true)}
                        onBack={() => {
                            if (peerRef.current) peerRef.current.destroy();
                            if (connRef.current) connRef.current.close();
                            setGameMode(GameMode.SINGLE_PLAYER);
                            setOpponentMode('WAITING');
                            setGameState(prev => ({...prev, phase: GamePhase.MENU}));
                        }}
                        onStart={startGame}
                        onSetRole={(role) => {
                            setMyRole(role);
                            if (gameMode === GameMode.SINGLE_PLAYER) setOpponentMode(opponentMode === 'COMPUTER' ? 'COMPUTER' : 'WAITING');
                        }}
                        onSetOpponentMode={setOpponentMode}
                    />
                )}
            </div>
        )}
        
        {(gameState.phase === GamePhase.PLAYING || 
          gameState.phase === GamePhase.GAME_OVER_HUNTER_WINS || 
          gameState.phase === GamePhase.GAME_OVER_DEMON_WINS) && (
            <div className="relative w-full h-full flex items-center justify-center">
                <div className="relative aspect-[4/3] h-full w-auto max-w-full max-h-full shadow-2xl flex items-center justify-center">
                    <GameCanvas gameState={gameState} cameraTarget={cameraTarget} />
                    
                    {gameState.phase !== GamePhase.PLAYING && (
                        <GameOverModal 
                            phase={gameState.phase} 
                            onRestart={() => setGameState(prev => ({...prev, phase: GamePhase.LOBBY}))} 
                        />
                    )}
                </div>
            </div>
        )}

        {/* Event Logs */}
        {gameState.phase === GamePhase.PLAYING && (
            <div className="fixed bottom-4 left-1/2 -translate-x-1/2 flex flex-col items-center z-20 px-4 w-full pointer-events-none gap-1">
                {gameState.messages.slice(0, 3).map((msg) => (
                    <p key={msg.id} className="text-xs md:text-base text-stone-100 text-shadow-md text-center bg-black/60 px-3 py-1 rounded-full border border-white/10 animate-in fade-in slide-in-from-bottom-2 backdrop-blur-sm transition-opacity duration-300">
                        {msg.text}
                    </p>
                ))}
            </div>
        )}
      </div>
    </div>
  );
};

export default App;
