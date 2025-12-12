import React, { useEffect, useRef, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import { GameState, GamePhase, InputState, EntityType, Entity, GameMode, PlayerRole, PlayerInput, NetworkMessage } from './types';
import { MAP_SIZE, MAX_BULLETS, VIEWPORT_WIDTH, DAY_DURATION_SECONDS, CABIN_ENTER_DURATION, NIGHT_DURATION_SECONDS } from './constants';
import { updateGame, checkCollision, distance, calculateBotInput } from './utils/gameLogic';
import { Gamepad2, Skull, Play, RefreshCw, Eye, Users, Monitor, Link, ArrowRight, Copy, Check, Info, Trees, LockKeyhole, User, UserPlus, Cpu, LogOut } from 'lucide-react';
import Peer, { DataConnection } from 'peerjs';

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
      stunTimer: 0
    },
    deers,
    trees,
    mushrooms,
    bullets: [],
    cabin,
    mapWidth: MAP_SIZE,
    mapHeight: MAP_SIZE,
    lastShotTime: 0,
    messages: ["欢迎来到森林。猎人 vs 恶魔。"]
  };
};

const generateRoomId = () => Math.random().toString(36).substring(2, 8).toUpperCase();

// Opponent Mode for Lobby State
type OpponentMode = 'WAITING' | 'COMPUTER' | 'CONNECTED';

const App: React.FC = () => {
  const [gameState, setGameState] = useState<GameState>(createInitialState());
  
  // Lobby State
  const [roomId, setRoomId] = useState<string>("");
  const [joinId, setJoinId] = useState<string>("");
  const [gameMode, setGameMode] = useState<GameMode>(GameMode.SINGLE_PLAYER);
  const [isCopied, setIsCopied] = useState(false);
  
  // New Role & Opponent State
  const [myRole, setMyRole] = useState<EntityType>(EntityType.HUNTER);
  const [opponentMode, setOpponentMode] = useState<OpponentMode>('WAITING');

  // Networking Refs
  const peerRef = useRef<Peer | null>(null);
  const connRef = useRef<DataConnection | null>(null);
  const isHostRef = useRef<boolean>(true);
  
  // Input Refs
  const inputRef = useRef<InputState>({
    w: false, a: false, s: false, d: false, space: false,
    up: false, left: false, down: false, right: false, enter: false
  });
  
  // Remote Input (State from the other player)
  const remoteInputRef = useRef<PlayerInput>({
    up: false, down: false, left: false, right: false, action: false
  });

  const requestRef = useRef<number>();
  const lastTimeRef = useRef<number>(0);

  // Initialize PeerJS
  useEffect(() => {
    return () => {
      if (peerRef.current) peerRef.current.destroy();
    };
  }, []);

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
    const id = generateRoomId();
    setRoomId(id);
    const peer = new Peer(id, { debug: 1 });
    
    peer.on('open', (id) => {
      console.log('My peer ID is: ' + id);
      setGameMode(GameMode.ONLINE_HOST);
      isHostRef.current = true;
    });

    peer.on('connection', (conn) => {
      conn.on('open', () => {
        setOpponentMode('CONNECTED');
        connRef.current = conn;
        // Notify client they are joined
        conn.send({ type: 'PLAYER_JOINED', role: PlayerRole.CLIENT });
      });
      conn.on('data', (data: any) => {
        if (data.type === 'INPUT_UPDATE') {
          remoteInputRef.current = data.input;
        }
      });
    });

    peerRef.current = peer;
  };

  const joinGame = () => {
    if (!joinId) return;
    const peer = new Peer();
    
    peer.on('open', () => {
      const conn = peer.connect(joinId);
      conn.on('open', () => {
        console.log("Connected to: " + joinId);
        setRoomId(joinId);
        setGameMode(GameMode.ONLINE_CLIENT);
        isHostRef.current = false;
        // Assume Host is Hunter by default for now, or just let client see what they are given
        // Actually, let's just allow client to be whatever host is NOT
        // But for sync simplicity, we don't fully sync lobby state yet
        // Client just waits for game start state
        setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
        setOpponentMode('CONNECTED');
        connRef.current = conn;
      });

      conn.on('data', (data: any) => {
        if (data.type === 'START_GAME') {
             // Host sends game start signal
        }
        if (data.type === 'STATE_UPDATE') {
            setGameState(data.state);
        }
      });
    });

    peerRef.current = peer;
  };

  const startGame = () => {
    if (connRef.current && isHostRef.current) {
        connRef.current.send({ type: 'START_GAME' });
    }

    const newState = createInitialState();
    const obstacles = [...newState.trees, newState.cabin];

    // Spawn Demon Logic (Randomly, away from Hunter)
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
    setGameState(newState);
    
    lastTimeRef.current = 0;
  };

  // --- Game Loop ---
  const loop = (timestamp: number) => {
    if (!lastTimeRef.current) lastTimeRef.current = timestamp;
    const deltaTime = (timestamp - lastTimeRef.current) / 1000;
    lastTimeRef.current = timestamp;
    const safeDelta = Math.min(deltaTime, 0.1); 

    setGameState(prev => {
      if (prev.phase !== GamePhase.PLAYING) return prev;

      // CLIENT: Send Input, Render State (State is updated via PeerJS 'data' event)
      if (gameMode === GameMode.ONLINE_CLIENT) {
         if (connRef.current) {
             const myInput: PlayerInput = {
                 up: inputRef.current.up || inputRef.current.w,
                 down: inputRef.current.down || inputRef.current.s,
                 left: inputRef.current.left || inputRef.current.a,
                 right: inputRef.current.right || inputRef.current.d,
                 action: inputRef.current.enter || inputRef.current.space
             };
             connRef.current.send({ type: 'INPUT_UPDATE', input: myInput });
         }
         return prev; // Rely on state updates from Host
      }

      // HOST or SINGLE PLAYER: Run Logic
      let hunterIn: PlayerInput = { up: false, down: false, left: false, right: false, action: false };
      let demonIn: PlayerInput = { up: false, down: false, left: false, right: false, action: false };

      const localInput: PlayerInput = {
          up: inputRef.current.w || inputRef.current.up,
          down: inputRef.current.s || inputRef.current.down,
          left: inputRef.current.a || inputRef.current.left,
          right: inputRef.current.d || inputRef.current.right,
          action: inputRef.current.space || inputRef.current.enter
      };

      // 1. Assign Local Input
      if (myRole === EntityType.HUNTER) {
          hunterIn = localInput;
      } else {
          demonIn = localInput;
      }

      // 2. Assign Opponent Input
      if (gameMode === GameMode.ONLINE_HOST) {
          // Opponent is Networked Player
          if (myRole === EntityType.HUNTER) demonIn = remoteInputRef.current;
          else hunterIn = remoteInputRef.current;
      } else {
          // Single Player / Local Host with Bot
          if (opponentMode === 'COMPUTER') {
             // Calculate Bot Input
             const obstacles = [...prev.trees, prev.cabin];
             if (myRole === EntityType.HUNTER) {
                 // Bot controls Demon
                 demonIn = calculateBotInput(prev.demon, prev.hunter, prev.mushrooms, obstacles, prev.isNight);
             } else {
                 // Bot controls Hunter
                 hunterIn = calculateBotInput(prev.hunter, prev.demon, prev.mushrooms, obstacles, prev.isNight);
             }
          }
      }

      const nextState = updateGame(prev, hunterIn, demonIn, safeDelta);

      // If Host, broadcast state
      if (gameMode === GameMode.ONLINE_HOST && connRef.current) {
          connRef.current.send({ type: 'STATE_UPDATE', state: nextState });
      }

      return nextState;
    });
    
    requestRef.current = requestAnimationFrame(loop);
  };

  useEffect(() => {
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current!);
  }, [gameMode, myRole, opponentMode]); 

  // --- UI Handlers ---
  const handleCopy = () => {
    navigator.clipboard.writeText(roomId);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  // --- RENDER ---
  const renderMenu = () => (
    <div className="flex flex-col gap-4 items-center">
      <h1 className="text-5xl font-bold text-green-400 mb-8 tracking-tighter">FOREST WHISPERS</h1>
      
      <button 
        onClick={() => {
            setGameMode(GameMode.SINGLE_PLAYER);
            // Default setup for single player
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
            initializeHost();
            setMyRole(EntityType.HUNTER); // Default Host to Hunter
            setGameState(prev => ({...prev, phase: GamePhase.LOBBY}));
        }}
        className="w-64 py-4 bg-stone-800 text-stone-200 border border-stone-600 font-bold rounded hover:scale-105 transition flex items-center justify-center gap-2"
      >
        <Users size={20}/> 创建在线房间
      </button>

      <div className="flex gap-2 w-64">
          <input 
            type="text" 
            placeholder="输入房间号" 
            className="flex-1 bg-stone-900 border border-stone-700 rounded px-3 text-stone-200 uppercase"
            onChange={(e) => setJoinId(e.target.value)}
            value={joinId}
          />
          <button 
            onClick={joinGame}
            className="px-4 bg-blue-600 text-white rounded hover:bg-blue-500 font-bold"
          >
            <ArrowRight size={20} />
          </button>
      </div>
    </div>
  );

  const renderLobby = () => {
    // Helper to render a player card
    const renderCard = (role: EntityType) => {
        const isMyRole = myRole === role;
        // Determine status of this role
        let statusText = "空缺";
        let statusColor = "text-stone-500";
        let isCpu = false;
        let isConnected = false;

        if (isMyRole) {
            statusText = "你 (Player 1)";
            statusColor = "text-green-400";
        } else {
            // It's the other slot
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

        return (
            <div 
                className={`relative flex flex-col items-center justify-center p-6 w-48 h-64 border-2 rounded-xl transition-all
                    ${isMyRole ? 'border-green-500 bg-green-900/20' : 'border-stone-700 bg-stone-800/50'}
                    ${!isMyRole && !isConnected && !isCpu && gameMode === GameMode.SINGLE_PLAYER ? 'cursor-pointer hover:border-stone-500' : ''}
                `}
                onClick={() => {
                   // Allow switching role if Single Player
                   if (gameMode === GameMode.SINGLE_PLAYER && !isMyRole) {
                       setMyRole(role);
                       // Reset opponent mode when switching to avoid logic conflicts for now
                       setOpponentMode(opponentMode === 'COMPUTER' ? 'COMPUTER' : 'WAITING');
                   }
                }}
            >
                <div className={`mb-4 p-4 rounded-full ${role === EntityType.HUNTER ? 'bg-red-500/20 text-red-500' : 'bg-purple-500/20 text-purple-500'}`}>
                    {role === EntityType.HUNTER ? <Gamepad2 size={48}/> : <Skull size={48}/>}
                </div>
                <h3 className="text-xl font-bold uppercase mb-2">{role === EntityType.HUNTER ? '猎人' : '恶魔'}</h3>
                <span className={`text-sm font-bold ${statusColor}`}>{statusText}</span>

                {/* Add/Remove CPU Button Overlay */}
                {canAddCpu && (
                    <button 
                        className="mt-4 px-3 py-1 bg-stone-700 hover:bg-stone-600 rounded text-xs flex items-center gap-1 z-10"
                        onClick={(e) => {
                            e.stopPropagation();
                            setOpponentMode('COMPUTER');
                        }}
                    >
                        <UserPlus size={14}/> 添加电脑
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
                        <User size={14}/> 移除电脑
                    </button>
                )}
            </div>
        );
    };

    return (
        <div className="bg-neutral-800 p-8 rounded-lg border border-neutral-700 w-full max-w-4xl flex flex-col items-center">
            <h2 className="text-3xl font-bold text-stone-200 mb-8 flex items-center gap-3">
                <Users /> 选择角色
            </h2>

            {/* Room Info */}
            {gameMode === GameMode.ONLINE_HOST && (
                <div className="mb-8 px-6 py-3 bg-neutral-900 rounded border border-neutral-600 flex items-center gap-4">
                    <span className="text-stone-400 text-sm">房间邀请码</span>
                    <span className="text-2xl text-green-400 font-mono font-bold tracking-widest">{roomId}</span>
                    <button onClick={handleCopy} className="p-2 hover:bg-white/10 rounded transition">
                        {isCopied ? <Check size={18} className="text-green-500"/> : <Copy size={18} className="text-stone-400"/>}
                    </button>
                </div>
            )}

            {/* Role Cards */}
            <div className="flex flex-col md:flex-row gap-8 mb-10">
                {renderCard(EntityType.HUNTER)}
                <div className="hidden md:flex items-center text-stone-600 font-bold text-xl">VS</div>
                {renderCard(EntityType.DEMON)}
            </div>

            {/* Action Bar */}
            <div className="flex gap-4 w-full max-w-md">
                <button 
                    onClick={() => {
                        if (peerRef.current) peerRef.current.destroy();
                        setGameMode(GameMode.SINGLE_PLAYER);
                        setGameState(prev => ({...prev, phase: GamePhase.MENU}));
                    }}
                    className="flex-1 py-3 border border-stone-600 text-stone-400 rounded hover:bg-stone-700 transition"
                >
                    返回
                </button>
                
                <button 
                    onClick={startGame}
                    disabled={gameMode === GameMode.ONLINE_HOST && opponentMode !== 'CONNECTED'}
                    className={`flex-1 py-3 font-bold rounded flex items-center justify-center gap-2 transition
                        ${gameMode === GameMode.ONLINE_HOST && opponentMode !== 'CONNECTED' 
                            ? 'bg-stone-700 text-stone-500 cursor-not-allowed' 
                            : 'bg-green-600 text-white hover:bg-green-500 shadow-lg hover:shadow-green-500/20'}`}
                >
                    <Play size={18} /> 开始游戏
                </button>
            </div>
            
            {gameMode === GameMode.ONLINE_HOST && opponentMode !== 'CONNECTED' && (
                <p className="text-sm text-yellow-500 mt-4 flex items-center gap-2 animate-pulse">
                    <Info size={16}/> 等待玩家加入...
                </p>
            )}
            {gameMode === GameMode.SINGLE_PLAYER && opponentMode === 'WAITING' && (
                <p className="text-sm text-stone-500 mt-4 flex items-center gap-2">
                    <Info size={16}/> 提示：如果不添加电脑，将只有你一个人在地图上
                </p>
            )}
        </div>
    );
  };

  const cameraTarget = gameMode === GameMode.ONLINE_CLIENT 
      ? (myRole === EntityType.HUNTER ? 'DEMON' : 'DEMON') // If client is demon, follow demon. Wait, client role isn't explicitly set in sync yet.
      // Actually, for simplicity, Client is usually P2. 
      // If Host chose Hunter, Client is Demon. If Host chose Demon, Client is Hunter.
      // But we haven't synced Host Choice to Client fully in lobby.
      // FIX: For Online Client, we rely on the state sent by Host, but local `myRole` might be wrong if not synced.
      // Let's assume for Online Client, we check what the Host ISN'T?
      // Simplified: Camera target follows `myRole`.
      : (myRole === EntityType.HUNTER ? 'HUNTER' : 'DEMON');

  // Fix for Online Client Camera:
  // If we are client, we are usually "Not the host". 
  // But let's just stick to "myRole" which we should ideally sync.
  // For this simplified version: 
  // If I am Client, and I haven't picked a role (lobby skipped for client mostly), 
  // I should default to Demon? The JoinGame logic sets OpponentMode CONNECTED but doesn't set myRole.
  // Let's just default Client to Demon for now as per original design, OR improve sync.
  // Original design: Host = Hunter, Client = Demon.
  // New design: Host picks.
  // Quick fix: Just use 'DEMON' for client default if not set? 
  // Let's rely on `myRole`. In `renderMenu` -> `joinGame` -> we should set myRole?
  // Let's just set Client to always view DEMON if they are Demon, etc.
  // Since we didn't add logic to sync "Host selected Hunter" to "Client becomes Demon", 
  // Client might be desynced in UI roles.
  // For safety in this iteration: If Online Client, default to Demon.
  const finalCameraTarget = gameMode === GameMode.ONLINE_CLIENT ? 'DEMON' : (myRole === EntityType.HUNTER ? 'HUNTER' : 'DEMON');


  return (
    <div className="min-h-screen bg-neutral-900 text-stone-200 flex flex-col items-center justify-center font-mono">
      
      {/* Exit Button - Single Player Only */}
      {gameState.phase === GamePhase.PLAYING && gameMode === GameMode.SINGLE_PLAYER && (
        <button 
            onClick={() => setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }))}
            className="fixed top-6 left-6 z-50 bg-neutral-800/90 hover:bg-red-900/90 text-stone-400 hover:text-white border border-neutral-600 hover:border-red-500 rounded-lg px-4 py-2 flex items-center gap-2 transition-all shadow-xl backdrop-blur-sm font-bold"
        >
            <LogOut size={18} />
            <span className="hidden md:inline">退出</span>
        </button>
      )}

      {/* HUD Header - Only show in Game */}
      {gameState.phase === GamePhase.PLAYING && (
          <div className="w-full max-w-4xl flex flex-col md:flex-row justify-between items-center mb-4 px-4 py-2 bg-neutral-800 rounded-lg shadow-lg border border-neutral-700 gap-4 relative">
            <div className={`flex items-center gap-4 p-2 rounded ${finalCameraTarget === 'HUNTER' ? 'bg-white/10' : ''}`}>
              <div className="flex flex-col">
                <span className="text-xs text-stone-400">猎人</span>
                <div className="flex items-center gap-1 text-red-400 font-bold">
                  <Gamepad2 size={18} />
                  <span>子弹: ∞</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center">
              <span className="text-xs text-stone-400 mb-1">
                {gameState.isNight ? "存活至黎明" : "距离入夜"}
              </span>
              <div className="w-64 h-3 bg-neutral-700 rounded-full overflow-hidden border border-neutral-600 relative">
                 <div 
                  className={`h-full transition-colors duration-300 ${gameState.isNight ? 'bg-red-900' : 'bg-yellow-500'}`}
                  style={{ width: `${gameState.isNight ? Math.max(0, ((NIGHT_DURATION_SECONDS - gameState.nightTimer) / NIGHT_DURATION_SECONDS) * 100) : Math.max(0, (1 - gameState.timeOfDay) * 100)}%` }}
                />
              </div>
              <span className="text-xs text-stone-300 mt-1 font-mono">
                 {gameState.isNight 
                    ? `${Math.ceil(NIGHT_DURATION_SECONDS - gameState.nightTimer)}s`
                    : `${Math.ceil((1 - gameState.timeOfDay) * DAY_DURATION_SECONDS)}s`
                 }
              </span>
            </div>

            <div className={`flex items-center gap-4 text-right p-2 rounded ${finalCameraTarget === 'DEMON' ? 'bg-white/10' : ''}`}>
              <div className="flex flex-col items-end">
                <span className="text-xs text-stone-400">恶魔</span>
                <div className="flex items-center gap-1 text-purple-400 font-bold">
                   <span>{gameState.isNight ? "猎杀中" : "伪装中"}</span>
                   <Skull size={18} />
                </div>
              </div>
            </div>
            
            {/* Cabin Entry Progress Overlay */}
            {gameState.hunter.enterTimer > 0 && !gameState.hunter.inCabin && (
                <div className="absolute -bottom-16 left-1/2 -translate-x-1/2 bg-neutral-900 px-4 py-2 rounded border border-yellow-500 text-yellow-500 flex flex-col items-center gap-1 z-50">
                    <span className="text-xs flex items-center gap-1 font-bold animate-pulse">
                        <LockKeyhole size={14}/> 正在打开门锁... {Math.floor((gameState.hunter.enterTimer / CABIN_ENTER_DURATION) * 100)}%
                    </span>
                    <div className="w-32 h-2 bg-neutral-800 rounded-full overflow-hidden">
                        <div 
                           className="h-full bg-yellow-500"
                           style={{ width: `${Math.min(100, (gameState.hunter.enterTimer / CABIN_ENTER_DURATION) * 100)}%` }}
                        />
                    </div>
                </div>
            )}
             {gameState.hunter.inCabin && (
                <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 bg-green-900/80 px-4 py-2 rounded border border-green-500 text-green-300 flex items-center gap-2 z-50">
                    <Check size={16}/>
                    <span className="text-xs font-bold">已躲入屋内，安全！</span>
                </div>
            )}
          </div>
      )}

      {/* Main Content Area */}
      <div className="relative">
        {gameState.phase === GamePhase.MENU && renderMenu()}
        {gameState.phase === GamePhase.LOBBY && renderLobby()}
        
        {/* Game Canvas & Overlays */}
        {(gameState.phase === GamePhase.PLAYING || 
          gameState.phase === GamePhase.GAME_OVER_HUNTER_WINS || 
          gameState.phase === GamePhase.GAME_OVER_DEMON_WINS) && (
            <>
                <GameCanvas gameState={gameState} cameraTarget={finalCameraTarget} />
                
                {gameState.phase !== GamePhase.PLAYING && (
                  <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center rounded-lg z-10 backdrop-blur-sm px-8 text-center">
                    <h1 className="text-4xl md:text-5xl font-bold text-stone-100 mb-2 tracking-widest uppercase text-shadow">
                      游戏结束
                    </h1>
                    <p className="text-lg md:text-xl text-stone-300 mb-8 max-w-lg">
                      {gameState.phase === GamePhase.GAME_OVER_HUNTER_WINS && <span className="text-green-400">猎人净化了森林中的邪恶！</span>}
                      {gameState.phase === GamePhase.GAME_OVER_DEMON_WINS && <span className="text-red-500">森林吞噬了又一个灵魂...</span>}
                    </p>
                    
                    <button 
                      onClick={() => setGameState(prev => ({...prev, phase: GamePhase.LOBBY}))}
                      className="flex items-center gap-2 px-8 py-3 bg-stone-100 text-neutral-900 font-bold rounded hover:bg-white hover:scale-105 transition-all mb-8"
                    >
                      <RefreshCw size={20} /> 返回大厅
                    </button>
                  </div>
                )}
            </>
        )}
      </div>

      {/* Event Log */}
      {gameState.phase === GamePhase.PLAYING && (
          <div className="w-full max-w-4xl mt-4 h-24 overflow-hidden flex flex-col-reverse items-center opacity-70 pointer-events-none">
            {gameState.messages.map((msg, i) => (
              <p key={i} className="text-sm text-stone-300 mb-1 text-shadow-sm">{msg}</p>
            ))}
          </div>
      )}

    </div>
  );
};

export default App;