import React, { useEffect, useRef, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import { MobileControls } from './components/MobileControls';
import { GameState, GamePhase, InputState, EntityType, Entity, GameMode, PlayerRole, PlayerInput } from './types';
import { MAP_SIZE, MAX_BULLETS, VIEWPORT_WIDTH, DAY_DURATION_SECONDS, CABIN_ENTER_DURATION, NIGHT_DURATION_SECONDS } from './constants';
import { updateGame, checkCollision, distance, calculateBotInput } from './utils/gameLogic';
import { Gamepad2, Skull, Play, RefreshCw, Users, Monitor, Link, ArrowRight, Copy, Check, Info, LockKeyhole, User, UserPlus, LogOut, BookOpen, X, Signal, Loader2, WifiOff, Activity } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

// Explicit STUN config for better mobile/network compatibility
const PEER_CONFIG = {
    debug: 1,
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' }
        ]
    }
};

// Helper to round entity for network transmission
const roundEntity = (e: any) => {
    if (!e || !e.pos) return e; // Safety check
    return {
        ...e,
        pos: { x: Math.round(e.pos.x), y: Math.round(e.pos.y) },
        velocity: e.velocity ? { x: Math.round(e.velocity.x), y: Math.round(e.velocity.y) } : undefined
    };
};

// --- Initial State Factory ---
const createInitialState = (): GameState => {
  const center = { x: MAP_SIZE / 2, y: MAP_SIZE / 2 };
  
  // 1. Create Cabin first to use for collision checks
  const cabin: Entity = {
    id: 'cabin',
    type: EntityType.CABIN,
    pos: { ...center },
    size: 25, // Smaller Cabin
    angle: 0
  };

  const obstacles: Entity[] = [cabin];

  // 2. Generate Trees (checking against Cabin and other Trees)
  const trees: Entity[] = [];
  const MAX_TREES = 40;
  const MIN_TREE_GAP = 60; 
  let attempts = 0;

  while (trees.length < MAX_TREES && attempts < 1000) {
    attempts++;
    const size = 20 + Math.random() * 15;
    const pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
    
    // Use checkCollision logic or custom distance for spawn logic
    let valid = true;
    
    // Check against existing trees
    for (const tree of trees) {
      if (distance(pos, tree.pos) < (size + tree.size + MIN_TREE_GAP)) {
        valid = false;
        break;
      }
    }
    // Check against Cabin (center)
    if (distance(pos, cabin.pos) < 150) valid = false;

    if (valid) {
      const newTree = {
        id: `tree-${trees.length}`,
        type: EntityType.TREE,
        pos,
        size,
        angle: 0
      };
      trees.push(newTree);
      obstacles.push(newTree); // Add to obstacles for subsequent checks
    }
  }

  // 3. Generate Deers (checking against Trees and Cabin)
  const deers: Entity[] = [];
  for (let i = 0; i < 15; i++) {
    let pos = { x: 0, y: 0 };
    let valid = false;
    let spawnAttempts = 0;

    // Try to find a valid spot
    while(!valid && spawnAttempts < 50) {
        spawnAttempts++;
        pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
        // Check collision with radius 12 (deer size)
        if (!checkCollision(pos, 12, obstacles)) {
            valid = true;
        }
    }

    deers.push({
      id: `deer-${i}`,
      type: EntityType.DEER,
      pos: valid ? pos : { x: 50, y: 50 }, // Fallback to corner if failed
      size: 12,
      angle: Math.floor(Math.random() * 8) * (Math.PI / 4), // 8-way direction
      aiState: {
        moving: Math.random() > 0.5,
        timer: Math.floor(Math.random() * 100) + 50
      }
    });
  }

  // Generate Mushrooms (Scattered)
  const mushrooms: Entity[] = [];
  const MIN_MUSHROOM_DIST = 100;

  for (let i = 0; i < 10; i++) {
    let pos = { x: 0, y: 0 };
    let valid = false;
    let spawnAttempts = 0;

    while(!valid && spawnAttempts < 20) {
      spawnAttempts++;
      pos = { x: Math.random() * MAP_SIZE, y: Math.random() * MAP_SIZE };
      
      // Check collision with trees/cabin
      if (checkCollision(pos, 10, obstacles)) continue;

      // Check distance from other mushrooms
      let tooClose = false;
      for (const other of mushrooms) {
          if (distance(pos, other.pos) < MIN_MUSHROOM_DIST) {
              tooClose = true;
              break;
          }
      }
      if (!tooClose) valid = true;
    }

    mushrooms.push({
      id: `mush-${i}`,
      type: EntityType.MUSHROOM,
      pos,
      size: 8,
      angle: 0
    });
  }

  return {
    phase: GamePhase.MENU, // Start at Menu
    timeOfDay: 0,
    isNight: false,
    nightTimer: 0, // Initialize night timer
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
    // Generate a robust 6-char ID
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I, 1, O, 0 for clarity
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
};

// Opponent Mode for Lobby State
type OpponentMode = 'WAITING' | 'COMPUTER' | 'CONNECTED';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(createInitialState());
  
  // Lobby State
  const [roomId, setRoomId] = useState<string>("");
  const [joinId, setJoinId] = useState<string>("");
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
  const gameStartedRef = useRef<boolean>(false); // NEW: Prevents premature state updates
  
  // DIAGNOSTICS
  const packetCountRef = useRef<number>(0);
  const [lastError, setLastError] = useState<string>("");

  // Networking Refs
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const isHostRef = useRef<boolean>(true);
  const networkTickRef = useRef<number>(0);
  const inputTickRef = useRef<number>(0);
  const pingIntervalRef = useRef<number | null>(null);
  
  // Input Refs
  const inputRef = useRef<InputState>({
    w: false, a: false, s: false, d: false, space: false,
    up: false, left: false, down: false, right: false, enter: false
  });
  
  // Remote Input (State from the other player)
  const remoteInputRef = useRef<PlayerInput>({
    up: false, down: false, left: false, right: false, action: false
  });

  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);

  // Initialize PeerJS cleanup
  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
      if (pingIntervalRef.current) clearInterval(pingIntervalRef.current);
    };
  }, []);

  // Detect Mobile
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile('ontouchstart' in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Sync Host Role to Client in Lobby
  useEffect(() => {
      if (gameMode === GameMode.ONLINE_HOST && connRef.current && opponentMode === 'CONNECTED') {
          // Safe send
          try {
             const lobbyMsg = { type: 'LOBBY_UPDATE', hostRole: myRole };
             connRef.current.send(lobbyMsg);
          } catch(e) { console.error("Lobby update failed", e); }
      }
  }, [myRole, gameMode, opponentMode]);

  // Shared Ping Logic (Bi-directional)
  useEffect(() => {
    if ((gameMode === GameMode.ONLINE_HOST || gameMode === GameMode.ONLINE_CLIENT) && opponentMode === 'CONNECTED') {
        pingIntervalRef.current = window.setInterval(() => {
            if (connRef.current && connRef.current.open) {
                try {
                    const pingMsg = { type: 'PING', timestamp: Date.now() };
                    connRef.current.send(pingMsg);
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


  // Keyboard Listeners
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if(['arrowup','arrowdown','arrowleft','arrowright',' '].includes(e.key.toLowerCase())) {
        e.preventDefault();
      }
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

  // --- Network Logic ---
  const initializeHost = () => {
    if (peerRef.current) {
        peerRef.current.destroy();
        peerRef.current = null;
    }
    if (connRef.current) {
        connRef.current.close();
        connRef.current = null;
    }

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
      console.log('My peer ID is: ' + id);
      setGameMode(GameMode.ONLINE_HOST);
      isHostRef.current = true;
    });
    
    peer.on('error', (err) => {
        if (peer !== peerRef.current) return;
        console.error("Host Peer Error:", err);
        setLastError(`HostErr: ${err.type}`);
        setJoinError("创建房间失败");
        window.alert(`创建失败: ${err.type}`);
        setGameState(prev => ({...prev, phase: GamePhase.MENU}));
    });

    peer.on('connection', (conn) => {
      if (peer !== peerRef.current) return;

      conn.on('open', () => {
        if (peer !== peerRef.current) return;
        setOpponentMode('CONNECTED');
        connRef.current = conn;
        lastPacketTimeRef.current = Date.now();
        // Host immediately sends LOBBY_UPDATE upon connection to sync roles
        try {
            conn.send({ type: 'LOBBY_UPDATE', hostRole: myRole });
        } catch(e) { console.error("Failed to send lobby update", e); }
      });
      conn.on('data', (data: any) => {
        lastPacketTimeRef.current = Date.now();
        if (data.type === 'INPUT_UPDATE') {
          remoteInputRef.current = data.input;
        } else if (data.type === 'PONG') {
            const rtt = Date.now() - data.timestamp;
            setLatency(rtt);
        }
      });
      conn.on('close', () => {
        if (conn === connRef.current) {
             setOpponentMode('WAITING');
             connRef.current = null;
             setLatency(null);
             gameStartedRef.current = false;
        }
      });
      conn.on('error', (err) => {
          console.error("Connection error", err);
          setLastError(`ConnErr: ${err.type}`);
      });
    });

    peerRef.current = peer;
  };

  const joinGame = () => {
    setJoinError("");
    if (!joinId) {
        setJoinError("请输入房间号");
        return;
    }
    
    setIsConnecting(true);

    if (peerRef.current) {
        peerRef.current.destroy();
    }

    // Generate random Client ID
    const peer = new Peer(generateRoomId(), PEER_CONFIG);
    
    peer.on('error', (err: any) => {
        if (peer !== peerRef.current) return;
        console.error("Peer Error:", err);
        setLastError(`ClientPeerErr: ${err.type}`);
        setIsConnecting(false);
        if (err.type === 'peer-unavailable') {
            setJoinError("房间号不存在或主机未连接");
        } else if (err.type === 'unavailable-id') {
            // Retry with new ID if collision (rare)
            setTimeout(joinGame, 100);
        } else {
            setJoinError(`连接错误 (${err.type})`);
        }
    });

    peer.on('open', (id) => {
      if (peer !== peerRef.current) return;
      
      const conn = peer.connect(joinId.trim().toUpperCase(), { reliable: true });
      
      // Connection Timeout Fallback (10s)
      const timeout = setTimeout(() => {
          if (peerRef.current === peer && opponentMode !== 'CONNECTED') {
              setJoinError("连接超时，请检查网络或重试");
              setIsConnecting(false);
              conn.close();
          }
      }, 10000);

      conn.on('open', () => {
        clearTimeout(timeout);
        if (peer !== peerRef.current) return;
        
        console.log("Connected to: " + joinId);
        setJoinError(""); 
        setIsConnecting(false);
        setShowJoinPanel(false); 
        setRoomId(joinId);
        setGameMode(GameMode.ONLINE_CLIENT);
        isHostRef.current = false;
        lastPacketTimeRef.current = Date.now();
        setIsLagging(false);
        gameStartedRef.current = false; // Reset start flag
        packetCountRef.current = 0;
        setLastError("");
        
        setMyRole(EntityType.DEMON); 
        
        setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
        setOpponentMode('CONNECTED');
        connRef.current = conn;
      });

      conn.on('data', (data: any) => {
        try {
            // Any data received means connection is alive
            lastPacketTimeRef.current = Date.now();
            if (isLagging) setIsLagging(false);
            packetCountRef.current += 1;

            if (data.type === 'LOBBY_UPDATE') {
                setMyRole(data.hostRole === EntityType.HUNTER ? EntityType.DEMON : EntityType.HUNTER);
            } else if (data.type === 'START_GAME') {
                // Mark game as started immediately
                gameStartedRef.current = true;
                
                if (data.clientRole) {
                    setMyRole(data.clientRole);
                }
                if (data.initialState) {
                    setGameState(data.initialState);
                    lastTimeRef.current = 0; 
                }
            } else if (data.type === 'STATE_UPDATE') {
                // CRITICAL: Ignore state updates if game hasn't officially started (prevents race conditions)
                if (!gameStartedRef.current) return;

                setGameState(prev => {
                    const newState = {
                        ...prev,
                        ...data.state,
                        // Keep existing static entities if not provided in update
                        trees: (data.state.trees && data.state.trees.length > 0) ? data.state.trees : prev.trees,
                        cabin: data.state.cabin ? data.state.cabin : prev.cabin,
                    };
                    return newState;
                });
            } else if (data.type === 'PING') {
                try { conn.send({ type: 'PONG', timestamp: data.timestamp }); } catch(e){}
            } else if (data.type === 'PONG') {
                const rtt = Date.now() - data.timestamp;
                setLatency(rtt);
            }
        } catch (err: any) {
            console.error("Packet Process Error", err);
            setLastError(`PktErr: ${err.message}`);
        }
      });
      
      conn.on('close', () => {
          clearTimeout(timeout);
          window.alert("Host disconnected");
          gameStartedRef.current = false;
          setLastError("Host Disconnected");
          setGameState(prev => ({...prev, phase: GamePhase.MENU}));
      });
      
      conn.on('error', (err) => {
          clearTimeout(timeout);
          console.error("Conn Error", err);
          setLastError(`ConnErr: ${err.type}`);
          setJoinError("连接断开");
          setIsConnecting(false);
      });
    });

    peerRef.current = peer;
  };

  const startGame = () => {
    if (gameMode === GameMode.ONLINE_CLIENT) return;

    if (gameMode === GameMode.ONLINE_HOST) {
        if (!connRef.current || opponentMode !== 'CONNECTED') {
            console.warn("Attempted to start game without valid connection");
            return;
        }
    }

    const newState = createInitialState();
    // No need to locally round for host physics, only for sending
    
    newState.demon.pos = { x: 100, y: 100 }; // Default, will override below
    const obstacles = [...newState.trees, newState.cabin];

    let attempts = 0;
    let valid = false;
    let spawnPos = { x: 100, y: 100 };

    while (!valid && attempts < 100) {
      const dx = Math.random() * (MAP_SIZE - 100) + 50;
      const dy = Math.random() * (MAP_SIZE - 100) + 50;
      const candidate = { x: dx, y: dy };
      const distFromHunter = distance(candidate, newState.hunter.pos);
      const isColliding = checkCollision(candidate, newState.demon.size, obstacles);
      if (distFromHunter > 300 && !isColliding) {
        valid = true;
        spawnPos = candidate;
      }
      attempts++;
    }
    
    newState.demon.pos = spawnPos;
    newState.phase = GamePhase.PLAYING;

    if (connRef.current && isHostRef.current) {
        const clientRole = myRole === EntityType.HUNTER ? EntityType.DEMON : EntityType.HUNTER;
        try {
            const fullState = JSON.parse(JSON.stringify(newState));
            connRef.current.send({ 
                type: 'START_GAME', 
                clientRole,
                initialState: fullState 
            });
            gameStartedRef.current = true; // Host also marks as started
        } catch(e) {
            console.error("Failed to send START_GAME", e);
        }
    }

    setGameState(newState);
    lastTimeRef.current = 0;
  };

  const loop = (timestamp: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const deltaTime = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;
    const safeDelta = Math.min(deltaTime, 0.1); 

    // CLIENT MODE
    if (gameMode === GameMode.ONLINE_CLIENT) {
        // Lag Detection
        if (opponentMode === 'CONNECTED') {
            const timeSinceLastPacket = Date.now() - lastPacketTimeRef.current;
            if (timeSinceLastPacket > 2500 && !isLagging) { 
                setIsLagging(true);
            }
        }

        inputTickRef.current += deltaTime;
        if (inputTickRef.current >= 0.033) { 
            if (connRef.current && connRef.current.open) {
                const myInput: PlayerInput = {
                    up: inputRef.current.up || inputRef.current.w,
                    down: inputRef.current.down || inputRef.current.s,
                    left: inputRef.current.left || inputRef.current.a,
                    right: inputRef.current.right || inputRef.current.d,
                    action: inputRef.current.enter || inputRef.current.space
                };
                try {
                    connRef.current.send({ type: 'INPUT_UPDATE', input: myInput });
                } catch(e) { /* Ignore send errors */ }
            }
            inputTickRef.current = 0;
        }
        
        requestRef.current = requestAnimationFrame(loop);
        return; 
    }

    // HOST MODE Logic
    setGameState(prev => {
      if (prev.phase !== GamePhase.PLAYING) return prev;

      let hunterIn: PlayerInput = { up: false, down: false, left: false, right: false, action: false };
      let demonIn: PlayerInput = { up: false, down: false, left: false, right: false, action: false };

      const localInput: PlayerInput = {
          up: inputRef.current.w || inputRef.current.up,
          down: inputRef.current.s || inputRef.current.down,
          left: inputRef.current.a || inputRef.current.left,
          right: inputRef.current.d || inputRef.current.right,
          action: inputRef.current.space || inputRef.current.enter
      };

      if (myRole === EntityType.HUNTER) {
          hunterIn = localInput;
      } else {
          demonIn = localInput;
      }

      if (gameMode === GameMode.ONLINE_HOST) {
          if (myRole === EntityType.HUNTER) demonIn = remoteInputRef.current;
          else hunterIn = remoteInputRef.current;
      } else {
          if (opponentMode === 'COMPUTER') {
             const obstacles = [...prev.trees, prev.cabin];
             if (myRole === EntityType.HUNTER) {
                 demonIn = calculateBotInput(prev.demon, prev.hunter, prev.mushrooms, obstacles, prev.isNight, safeDelta);
             } else {
                 hunterIn = calculateBotInput(prev.hunter, prev.demon, prev.mushrooms, obstacles, prev.isNight, safeDelta);
             }
          }
      }

      let nextState;
      try {
          nextState = updateGame(prev, hunterIn, demonIn, safeDelta);
      } catch (err) {
          console.error("Game Logic Error:", err);
          return prev; 
      }

      if (gameMode === GameMode.ONLINE_HOST && connRef.current) {
          networkTickRef.current += deltaTime;
          if (networkTickRef.current >= 0.05) { // 20 updates per second
              try {
                  if (connRef.current.open) {
                      // Optimization: Round coordinates integers to save bandwidth
                      const dynamicState = {
                          ...nextState,
                          hunter: roundEntity(nextState.hunter),
                          demon: roundEntity(nextState.demon),
                          deers: nextState.deers.map(roundEntity),
                          bullets: nextState.bullets.map(b => ({...b, pos: {x: Math.round(b.pos.x), y: Math.round(b.pos.y)}})),
                          mushrooms: nextState.mushrooms // Static positions, but list changes
                      };
                      
                      // Remove static heavy objects
                      const { trees, cabin, ...optimizedState } = dynamicState;
                      connRef.current.send({ type: 'STATE_UPDATE', state: optimizedState });
                  }
              } catch(e) {
                  // swallow errors
              }
              networkTickRef.current = 0;
          }
      }

      return nextState;
    });
    
    requestRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [gameMode, myRole, opponentMode]); 

  // ... (Rest of UI components renderRules, renderMenu, renderLobby, and main Render remain largely same but preserved in full output below)
  
  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const renderJoinPanel = () => (
      <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-neutral-800 border border-stone-600 rounded-lg max-w-md w-full p-8 relative shadow-2xl flex flex-col items-center gap-6">
              <button 
                  onClick={() => !isConnecting && setShowJoinPanel(false)}
                  className="absolute top-4 right-4 text-stone-400 hover:text-white disabled:opacity-50"
                  disabled={isConnecting}
              >
                  <X size={24} />
              </button>
              
              <h2 className="text-3xl font-bold text-stone-200 flex items-center gap-2">
                  <Link size={28} className="text-blue-400"/> 加入游戏
              </h2>
              
              <div className="w-full flex flex-col gap-2">
                  <label className="text-xs text-stone-400 uppercase font-bold tracking-wider ml-1">输入房间号</label>
                  <input 
                      type="text" 
                      placeholder="CODE" 
                      className={`w-full bg-stone-900 border-2 rounded-lg p-4 text-center text-3xl font-mono tracking-widest text-white uppercase focus:outline-none focus:ring-2 transition-all disabled:opacity-50
                          ${joinError ? 'border-red-500 focus:ring-red-500/50' : 'border-stone-700 focus:border-blue-500 focus:ring-blue-500/50'}`}
                      onChange={(e) => {
                          setJoinId(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')); // Sanitize
                          if(joinError) setJoinError("");
                      }}
                      value={joinId}
                      maxLength={6}
                      disabled={isConnecting}
                      autoCapitalize="characters"
                  />
                  {joinError && (
                      <span className="text-sm text-red-500 font-bold text-center animate-pulse flex items-center justify-center gap-1">
                          <Info size={14}/> {joinError}
                      </span>
                  )}
              </div>

              <button 
                  onClick={joinGame}
                  disabled={isConnecting}
                  className={`w-full py-4 text-white rounded-lg font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all
                      ${isConnecting 
                          ? 'bg-stone-600 cursor-not-allowed' 
                          : 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/20 active:scale-95'}`}
              >
                  {isConnecting ? <Loader2 className="animate-spin" /> : <ArrowRight size={20} />} 
                  {isConnecting ? "连接中..." : "连接房间"}
              </button>
          </div>
      </div>
  );

  const renderRules = () => (
      <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-neutral-800 border border-stone-600 rounded-lg max-w-2xl w-full p-6 relative shadow-2xl overflow-y-auto max-h-[90vh]">
              <button 
                  onClick={() => setShowRules(false)}
                  className="absolute top-4 right-4 text-stone-400 hover:text-white"
              >
                  <X size={24} />
              </button>
              
              <h2 className="text-3xl font-bold text-green-400 mb-6 flex items-center gap-2">
                  <BookOpen /> 游戏规则
              </h2>

              <div className="space-y-6 text-stone-300">
                  <section>
                      <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1">1. 角色目标</h3>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="bg-red-900/20 p-4 rounded border border-red-900/50">
                              <h4 className="font-bold text-red-400 mb-1 flex items-center gap-2"><Gamepad2 size={16}/> 猎人</h4>
                              <p className="text-sm">在<strong>白天</strong>辨认并射杀伪装的恶魔。</p>
                              <p className="text-sm mt-2">如果在夜晚存活到黎明（180秒+40秒），猎人获胜。</p>
                          </div>
                          <div className="bg-purple-900/20 p-4 rounded border border-purple-900/50">
                              <h4 className="font-bold text-purple-400 mb-1 flex items-center gap-2"><Skull size={16}/> 恶魔</h4>
                              <p className="text-sm">在<strong>夜晚</strong>现出真身并击杀猎人。</p>
                              <p className="text-sm mt-2">吞噬蘑菇可以加速夜晚降临。</p>
                          </div>
                      </div>
                  </section>

                  <section>
                      <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1">2. 昼夜机制</h3>
                      <ul className="list-disc list-inside space-y-2 text-sm">
                          <li><span className="text-yellow-400 font-bold">白天 (180秒)</span>: 猎人视野开阔。恶魔伪装成无害的鹿。猎人开枪会受到“时间惩罚”，加速入夜。</li>
                          <li><span className="text-red-500 font-bold">夜晚 (40秒)</span>: 恶魔现出原形，视野变小但速度极快。猎人无法在夜晚彻底杀死恶魔，只能将其<strong>击晕0.5秒</strong>。</li>
                      </ul>
                  </section>

                  <section>
                      <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1">3. 关键道具 & 技能</h3>
                      <ul className="list-disc list-inside space-y-2 text-sm">
                          <li><strong>木屋</strong>: 地图中央的安全区。猎人在门前停留5秒可进入，进入后夜晚无敌。</li>
                          <li><strong>蘑菇</strong>: 散落在地图各处。恶魔吃掉蘑菇会显著加速时间流逝（加速入夜）。</li>
                          <li><span className="text-purple-400 font-bold">恶魔追踪</span>: 夜晚时，恶魔可以使用一次交互键来感知猎人的方位（显示红色箭头）。</li>
                      </ul>
                  </section>
              </div>
          </div>
      </div>
  );

  const renderMenu = () => (
    <div className="flex flex-col gap-4 items-center">
      <h1 className="text-4xl md:text-5xl font-bold text-green-400 mb-8 tracking-tighter text-center">FOREST WHISPERS</h1>
      
      <button 
        onClick={() => {
            setGameMode(GameMode.SINGLE_PLAYER);
            setMyRole(EntityType.HUNTER);
            setOpponentMode('WAITING');
            setGameState(prev => ({...prev, phase: GamePhase.LOBBY}));
        }}
        className="w-64 py-4 bg-stone-100 text-stone-900 font-bold rounded hover:scale-105 transition flex items-center justify-center gap-2"
      >
        <Monitor size={20}/> 本地游戏 / 单人
      </button>

      <button 
        onClick={() => {
            setGameMode(GameMode.ONLINE_HOST); 
            setOpponentMode('WAITING');
            setLatency(null);

            initializeHost();
            setMyRole(EntityType.HUNTER);
            setGameState(prev => ({...prev, phase: GamePhase.LOBBY}));
        }}
        className="w-64 py-4 bg-stone-800 text-stone-200 border border-stone-600 font-bold rounded hover:scale-105 transition flex items-center justify-center gap-2"
      >
        <Users size={20}/> 创建在线房间
      </button>

      <button 
        onClick={() => {
            setJoinError("");
            setShowJoinPanel(true);
        }}
        className="w-64 py-4 bg-stone-800 text-stone-200 border border-stone-600 font-bold rounded hover:scale-105 transition flex items-center justify-center gap-2"
      >
        <Link size={20}/> 加入在线房间
      </button>
    </div>
  );

  const renderLobby = () => {
    const isGuest = gameMode === GameMode.ONLINE_CLIENT;
    const isOnline = gameMode === GameMode.ONLINE_HOST || gameMode === GameMode.ONLINE_CLIENT;

    const renderCard = (role: EntityType) => {
        const isMyRole = myRole === role;
        let statusText = "空缺";
        let statusColor = "text-stone-500";
        let isCpu = false;
        let isConnected = false;

        if (isMyRole) {
            statusText = "你 (Player 1)";
            statusColor = "text-green-400";
        } else {
            if (opponentMode === 'WAITING') {
                statusText = gameMode === GameMode.SINGLE_PLAYER ? "点击添加电脑" : "等待加入...";
                statusColor = "text-yellow-500";
            } else if (opponentMode === 'COMPUTER') {
                statusText = "电脑 (AI)";
                statusColor = "text-purple-400";
                isCpu = true;
            } else if (opponentMode === 'CONNECTED') {
                statusText = "玩家 2 (已连接)";
                statusColor = "text-blue-400";
                isConnected = true;
            }
        }

        const canAddCpu = !isMyRole && gameMode === GameMode.SINGLE_PLAYER && opponentMode !== 'COMPUTER';
        const canRemoveCpu = !isMyRole && gameMode === GameMode.SINGLE_PLAYER && opponentMode === 'COMPUTER';
        
        const canSwitchRole = (gameMode === GameMode.SINGLE_PLAYER || gameMode === GameMode.ONLINE_HOST) && !isMyRole;

        return (
            <div 
                className={`relative flex flex-col items-center justify-center p-4 w-40 h-56 md:w-48 md:h-64 border-2 rounded-xl transition-all
                    ${isMyRole ? 'border-green-500 bg-green-900/20' : 'border-stone-700 bg-stone-800/50'}
                    ${canSwitchRole ? 'cursor-pointer hover:border-stone-500 hover:scale-105' : ''}
                `}
                onClick={() => {
                   if (canSwitchRole) {
                       setMyRole(role);
                       if (gameMode === GameMode.SINGLE_PLAYER) {
                           setOpponentMode(opponentMode === 'COMPUTER' ? 'COMPUTER' : 'WAITING');
                       }
                   }
                }}
            >
                <div className={`mb-4 p-4 rounded-full ${role === EntityType.HUNTER ? 'bg-red-500/20 text-red-500' : 'bg-purple-500/20 text-purple-500'}`}>
                    {role === EntityType.HUNTER ? <Gamepad2 size={48}/> : <Skull size={48}/>}
                </div>
                <h3 className="text-lg md:text-xl font-bold uppercase mb-2">{role === EntityType.HUNTER ? '猎人' : '恶魔'}</h3>
                <span className={`text-xs md:text-sm font-bold ${statusColor}`}>{statusText}</span>

                {canAddCpu && (
                    <button 
                        className="mt-4 px-3 py-1 bg-stone-700 hover:bg-stone-600 rounded text-xs flex items-center gap-1 z-10"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpponentMode('COMPUTER');
                        }}
                    >
                        <UserPlus size={14}/> <span className="hidden md:inline">电脑</span>
                    </button>
                )}
                {canRemoveCpu && (
                    <button 
                        className="mt-4 px-3 py-1 bg-red-900/50 hover:bg-red-900 text-red-200 rounded text-xs flex items-center gap-1 z-10"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpponentMode('WAITING');
                        }}
                    >
                        <User size={14}/> <span className="hidden md:inline">移除</span>
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="bg-neutral-800 p-4 md:p-8 rounded-lg border border-neutral-700 w-full max-w-4xl flex flex-col items-center relative my-auto">
            <h2 className="text-2xl md:text-3xl font-bold text-stone-200 mb-6 flex items-center gap-3">
                <Users /> 选择角色 {isOnline && <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded border border-blue-500/30">在线模式</span>}
            </h2>

            <button 
                onClick={() => setShowRules(true)}
                className="absolute top-4 right-4 md:top-8 md:right-8 text-stone-400 hover:text-green-400 flex items-center gap-2 transition"
            >
                <BookOpen size={20} /> <span className="hidden sm:inline">规则</span>
            </button>

            {gameMode === GameMode.ONLINE_HOST && (
                <div className="mb-6 px-4 py-2 bg-neutral-900 rounded border border-neutral-600 flex items-center gap-4">
                    <span className="text-stone-400 text-xs md:text-sm">房间号</span>
                    <span className="text-xl md:text-2xl text-green-400 font-mono font-bold tracking-widest">{roomId}</span>
                    <button onClick={handleCopy} className="p-2 hover:bg-white/10 rounded transition">
                        {isCopied ? <Check size={18} className="text-green-500"/> : <Copy size={18} className="text-stone-400"/>}
                    </button>
                </div>
            )}
            
            {/* Latency Display in Lobby */}
            {opponentMode === 'CONNECTED' && latency !== null && (
                <div className="absolute top-4 left-4 md:top-8 md:left-8 flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full border border-white/10">
                    <Signal size={16} className={latency < 100 ? "text-green-500" : latency < 200 ? "text-yellow-500" : "text-red-500"} />
                    <div className="flex flex-col">
                        <span className="text-stone-400 text-[10px] font-bold leading-none uppercase">Ping</span>
                        <span className="text-stone-200 text-xs font-mono leading-none">{latency}ms</span>
                    </div>
                </div>
            )}

            <div className="flex flex-row gap-4 md:gap-8 mb-8">
                {renderCard(EntityType.HUNTER)}
                <div className="hidden md:flex items-center text-stone-600 font-bold text-xl">VS</div>
                {renderCard(EntityType.DEMON)}
            </div>

            <div className="flex gap-4 w-full max-w-md">
                <button 
                    onClick={() => {
                        if (peerRef.current) peerRef.current.destroy();
                        if (connRef.current) connRef.current.close();
                        setGameMode(GameMode.SINGLE_PLAYER);
                        setOpponentMode('WAITING');
                        setGameState(prev => ({...prev, phase: GamePhase.MENU}));
                    }}
                    className="flex-1 py-3 border border-stone-600 text-stone-400 rounded hover:bg-stone-700 transition"
                >
                    返回
                </button>
                
                {gameMode === GameMode.SINGLE_PLAYER ? (
                    <button 
                        onClick={startGame}
                        className="flex-1 py-3 font-bold rounded flex items-center justify-center gap-2 transition bg-green-600 text-white hover:bg-green-500 shadow-lg hover:shadow-green-500/20"
                    >
                        <Play size={18} /> 开始游戏
                    </button>
                ) : (
                    <button 
                        onClick={startGame}
                        disabled={isGuest || (gameMode === GameMode.ONLINE_HOST && opponentMode !== 'CONNECTED')}
                        className={`flex-1 py-3 font-bold rounded flex items-center justify-center gap-2 transition
                            ${(isGuest || (gameMode === GameMode.ONLINE_HOST && opponentMode !== 'CONNECTED'))
                                ? 'bg-stone-700 text-stone-500 cursor-not-allowed' 
                                : 'bg-green-600 text-white hover:bg-green-500 shadow-lg hover:shadow-green-500/20'}`}
                    >
                        {isGuest 
                            ? <div className="flex flex-col items-center leading-none">
                                <span className="flex items-center gap-2"><Info size={18} /> 等待房主开始</span>
                                {latency !== null && <span className="text-[10px] opacity-70 mt-1 font-mono">延迟: {latency}ms</span>}
                              </div>
                            : (opponentMode === 'CONNECTED' ? <><Play size={18} /> 开始游戏</> : <><Users size={18} /> 等待玩家加入...</>)
                        }
                    </button>
                )}
            </div>
            
            {gameMode === GameMode.ONLINE_HOST && opponentMode !== 'CONNECTED' && (
                <p className="text-sm text-yellow-500 mt-4 flex items-center gap-2 animate-pulse">
                    <Info size={16}/> 等待玩家加入以开始游戏...
                </p>
            )}
            {gameMode === GameMode.SINGLE_PLAYER && opponentMode === 'WAITING' && (
                <p className="text-xs md:text-sm text-stone-500 mt-4 flex items-center gap-2 text-center">
                    <Info size={16}/> 提示：如果不添加电脑，将只有你一个人在地图上
                </p>
            )}
        </div>
    );
  };

  const cameraTarget = myRole === EntityType.HUNTER ? 'HUNTER' : 'DEMON';
  const isPlaying = gameState.phase === GamePhase.PLAYING;

  return (
    <div className={`h-[100dvh] w-full bg-neutral-900 text-stone-200 flex flex-col items-center font-mono overflow-hidden relative`}>
      
      {showRules && renderRules()}
      {showJoinPanel && renderJoinPanel()}
      
      {isMobile && gameState.phase === GamePhase.PLAYING && (
         <MobileControls 
             inputRef={inputRef} 
             onExit={gameMode === GameMode.SINGLE_PLAYER ? () => setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY })) : undefined}
         />
      )}

      {/* DIAGNOSTIC OVERLAY for ONLINE CLIENT */}
      {gameMode === GameMode.ONLINE_CLIENT && gameState.phase === GamePhase.PLAYING && (
          <div className="absolute top-16 right-4 z-50 bg-black/60 p-2 rounded text-[10px] font-mono border border-stone-600 flex flex-col gap-1 w-32 backdrop-blur-sm pointer-events-none">
             <div className="flex justify-between border-b border-stone-600 pb-1 mb-1">
                 <span className="font-bold text-blue-400">DEBUG</span>
                 <span>{roomId}</span>
             </div>
             <div className="flex justify-between">
                 <span>Packets:</span>
                 <span className="text-green-400">{packetCountRef.current}</span>
             </div>
             <div className="flex justify-between">
                 <span>Latency:</span>
                 <span className={latency && latency > 200 ? "text-red-500" : "text-stone-300"}>{latency ?? '-'}ms</span>
             </div>
             <div className="flex justify-between">
                 <span>Trees:</span>
                 <span className={gameState.trees.length === 0 ? "text-red-500 font-bold" : "text-stone-300"}>{gameState.trees.length}</span>
             </div>
             <div className="flex justify-between">
                 <span>Ents:</span>
                 <span className="text-stone-300">{gameState.deers.length + gameState.mushrooms.length + (gameState.cabin ? 1 : 0)}</span>
             </div>
             {lastError && (
                 <div className="mt-1 pt-1 border-t border-red-900 text-red-400 break-words leading-tight">
                     ! {lastError.substring(0, 40)}
                 </div>
             )}
          </div>
      )}

      {gameState.phase === GamePhase.PLAYING && gameMode === GameMode.SINGLE_PLAYER && !isMobile && (
        <button 
            onClick={() => setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }))}
            className="fixed top-4 left-4 z-50 bg-neutral-800/80 hover:bg-red-900/90 text-stone-400 hover:text-white border border-neutral-600 hover:border-red-500 rounded-lg px-3 py-2 flex items-center gap-2 transition-all shadow-xl backdrop-blur-sm font-bold text-sm"
        >
            <LogOut size={16} />
            <span className="hidden md:inline">退出</span>
        </button>
      )}

      {/* Latency / Lag Indicator in Game */}
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

      {gameState.phase === GamePhase.PLAYING && (
          <div className="absolute top-2 left-1/2 -translate-x-1/2 w-full max-w-4xl flex flex-row justify-between items-center px-4 py-1 z-20 pointer-events-none">
             <div className="flex flex-row justify-between items-center w-full bg-neutral-900/60 backdrop-blur-md rounded-xl p-1 border border-white/5 shadow-2xl">
                <div className={`flex items-center gap-2 p-1 px-3 rounded-lg transition-colors ${cameraTarget === 'HUNTER' ? 'bg-white/10 ring-1 ring-white/20' : ''}`}>
                <div className="flex flex-col">
                    <span className="text-[10px] text-stone-400 leading-tight">猎人</span>
                    <div className="flex items-center gap-1 text-red-400 font-bold text-xs md:text-sm">
                    <Gamepad2 size={14} className="md:w-5 md:h-5" />
                    <span>∞</span>
                    </div>
                </div>
                </div>

                <div className="flex flex-col items-center flex-1 mx-2 md:mx-4">
                <span className="text-[10px] md:text-xs text-stone-400 mb-0.5 leading-none font-bold text-shadow">
                    {gameState.isNight ? "存活" : "入夜"}
                </span>
                <div className="w-full md:w-64 h-2 md:h-3 bg-neutral-700/50 rounded-full overflow-hidden border border-white/10 relative">
                    <div 
                    className={`h-full transition-colors duration-300 ${gameState.isNight ? 'bg-red-600' : 'bg-yellow-500'}`}
                    style={{ width: `${gameState.isNight ? Math.max(0, ((NIGHT_DURATION_SECONDS - gameState.nightTimer) / NIGHT_DURATION_SECONDS) * 100) : Math.max(0, (1 - gameState.timeOfDay) * 100)}%` }}
                    />
                </div>
                <span className="text-[10px] md:text-xs text-stone-300 mt-0.5 font-mono leading-none">
                    {gameState.isNight 
                        ? `${Math.ceil(NIGHT_DURATION_SECONDS - gameState.nightTimer)}s`
                        : `${Math.ceil((1 - gameState.timeOfDay) * DAY_DURATION_SECONDS)}s`
                    }
                </span>
                </div>

                <div className={`flex items-center gap-2 text-right p-1 px-3 rounded-lg transition-colors ${cameraTarget === 'DEMON' ? 'bg-white/10 ring-1 ring-white/20' : ''}`}>
                <div className="flex flex-col items-end">
                    <span className="text-[10px] text-stone-400 leading-tight">恶魔</span>
                    <div className="flex items-center gap-1 text-purple-400 font-bold text-xs md:text-sm">
                    <span>{gameState.isNight ? "猎杀" : "伪装"}</span>
                    <Skull size={14} className="md:w-5 md:h-5" />
                    </div>
                </div>
                </div>
             </div>
            
            {gameState.hunter.enterTimer > 0 && !gameState.hunter.inCabin && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-neutral-900/90 px-3 py-1 rounded border border-yellow-500 text-yellow-500 flex flex-col items-center gap-1 z-50 shadow-xl backdrop-blur">
                    <span className="text-[10px] flex items-center gap-1 font-bold animate-pulse whitespace-nowrap">
                        <LockKeyhole size={10}/> 开锁中... {Math.floor((gameState.hunter.enterTimer / CABIN_ENTER_DURATION) * 100)}%
                    </span>
                    <div className="w-24 h-1.5 bg-neutral-800 rounded-full overflow-hidden">
                        <div 
                           className="h-full bg-yellow-500"
                           style={{ width: `${Math.min(100, (gameState.hunter.enterTimer / CABIN_ENTER_DURATION) * 100)}%` }}
                        />
                    </div>
                </div>
            )}
             {gameState.hunter.inCabin && (
                <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-green-900/90 px-3 py-1 rounded border border-green-500 text-green-300 flex items-center gap-2 z-50 shadow-xl">
                    <Check size={12}/>
                    <span className="text-[10px] font-bold whitespace-nowrap">已躲入屋内</span>
                </div>
            )}
          </div>
      )}

      <div className={`w-full h-full flex items-center justify-center overflow-y-auto ${gameState.phase !== GamePhase.PLAYING ? 'py-8' : ''}`}>
        
        {(gameState.phase === GamePhase.MENU || gameState.phase === GamePhase.LOBBY) && (
            <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center min-h-full">
                {gameState.phase === GamePhase.MENU && renderMenu()}
                {gameState.phase === GamePhase.LOBBY && renderLobby()}
            </div>
        )}
        
        {(gameState.phase === GamePhase.PLAYING || 
          gameState.phase === GamePhase.GAME_OVER_HUNTER_WINS || 
          gameState.phase === GamePhase.GAME_OVER_DEMON_WINS) && (
            <div className="relative w-full h-full flex items-center justify-center">
                <div className="relative aspect-[4/3] h-full w-auto max-w-full max-h-full shadow-2xl flex items-center justify-center">
                    <GameCanvas gameState={gameState} cameraTarget={cameraTarget} />
                    
                    {gameState.phase !== GamePhase.PLAYING && (
                    <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center rounded-lg z-30 backdrop-blur-sm px-8 text-center border-2 border-stone-800">
                        <h1 className="text-2xl md:text-5xl font-bold text-stone-100 mb-2 tracking-widest uppercase text-shadow">
                        游戏结束
                        </h1>
                        <p className="text-md md:text-xl text-stone-300 mb-8 max-w-lg">
                        {gameState.phase === GamePhase.GAME_OVER_HUNTER_WINS && <span className="text-green-400">猎人净化了森林中的邪恶！</span>}
                        {gameState.phase === GamePhase.GAME_OVER_DEMON_WINS && <span className="text-red-500">森林吞噬了又一个灵魂...</span>}
                        </p>
                        
                        <button 
                        onClick={() => setGameState(prev => ({...prev, phase: GamePhase.LOBBY}))}
                        className="flex items-center gap-2 px-8 py-3 bg-stone-100 text-neutral-900 font-bold rounded hover:bg-white hover:scale-105 transition-all mb-8 pointer-events-auto"
                        >
                        <RefreshCw size={20} /> 返回大厅
                        </button>
                    </div>
                    )}
                </div>
            </div>
        )}

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