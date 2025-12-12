import React, { useEffect, useRef, useState } from 'react';
import GameCanvas from './components/GameCanvas';
import { MobileControls } from './components/MobileControls';
import { GameState, GamePhase, InputState, EntityType, Entity, GameMode, PlayerRole, PlayerInput, NetworkMessage } from './types';
import { MAP_SIZE, MAX_BULLETS, VIEWPORT_WIDTH, DAY_DURATION_SECONDS, CABIN_ENTER_DURATION, NIGHT_DURATION_SECONDS } from './constants';
import { updateGame, checkCollision, distance, calculateBotInput } from './utils/gameLogic';
import { Gamepad2, Skull, Play, RefreshCw, Eye, Users, Monitor, Link, ArrowRight, Copy, Check, Info, Trees, LockKeyhole, User, UserPlus, Cpu, LogOut, BookOpen, X } from 'lucide-react';
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
  const [showRules, setShowRules] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  
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
          connRef.current.send({ type: 'LOBBY_UPDATE', hostRole: myRole });
      }
  }, [myRole, gameMode, opponentMode]);

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
        // Notify client they are joined and sync initial role
        conn.send({ type: 'PLAYER_JOINED', role: PlayerRole.CLIENT });
        // Also send current host role so client can update lobby UI
        // We do this via LOBBY_UPDATE in the useEffect, but good to trigger here if needed
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
        
        // Default client to opposite of default host (Demon), but will be updated via LOBBY_UPDATE
        setMyRole(EntityType.DEMON); 
        
        setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }));
        setOpponentMode('CONNECTED');
        connRef.current = conn;
      });

      conn.on('data', (data: any) => {
        if (data.type === 'LOBBY_UPDATE') {
            // Host changed role, so Client takes the opposite
            setMyRole(data.hostRole === EntityType.HUNTER ? EntityType.DEMON : EntityType.HUNTER);
        }
        if (data.type === 'START_GAME') {
             // Host sends game start signal with assigned role
             if (data.clientRole) {
                 setMyRole(data.clientRole);
             }
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
        // Host determines roles: Host is 'myRole', Client is opposite
        const clientRole = myRole === EntityType.HUNTER ? EntityType.DEMON : EntityType.HUNTER;
        connRef.current.send({ type: 'START_GAME', clientRole });
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
                          <li><span className="text-red-500 font-bold">夜晚 (40秒)</span>: 恶魔现出原形，视野变小但速度极快。猎人无法在夜晚彻底杀死恶魔，只能将其<strong>击晕2秒</strong>。</li>
                      </ul>
                  </section>

                  <section>
                      <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1">3. 关键道具</h3>
                      <ul className="list-disc list-inside space-y-2 text-sm">
                          <li><strong>木屋</strong>: 地图中央的安全区。猎人在门前停留5秒可进入，进入后夜晚无敌。</li>
                          <li><strong>蘑菇</strong>: 散落在地图各处。恶魔吃掉蘑菇会显著加速时间流逝（加速入夜）。</li>
                      </ul>
                  </section>
              </div>
          </div>
      </div>
  );

  // --- RENDER ---
  const renderMenu = () => (
    <div className="flex flex-col gap-4 items-center">
      <h1 className="text-4xl md:text-5xl font-bold text-green-400 mb-8 tracking-tighter text-center">FOREST WHISPERS</h1>
      
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
        
        // Host (or Single Player) can switch roles by clicking the OTHER card
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
                       // If Single Player, reset opponent mode if needed or keep it
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

                {/* Add/Remove CPU Button Overlay */}
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
        <div className="bg-neutral-800 p-4 md:p-8 rounded-lg border border-neutral-700 w-full max-w-4xl flex flex-col items-center relative">
            <h2 className="text-2xl md:text-3xl font-bold text-stone-200 mb-6 flex items-center gap-3">
                <Users /> 选择角色
            </h2>

            <button 
                onClick={() => setShowRules(true)}
                className="absolute top-4 right-4 md:top-8 md:right-8 text-stone-400 hover:text-green-400 flex items-center gap-2 transition"
            >
                <BookOpen size={20} /> <span className="hidden sm:inline">规则</span>
            </button>

            {/* Room Info */}
            {gameMode === GameMode.ONLINE_HOST && (
                <div className="mb-6 px-4 py-2 bg-neutral-900 rounded border border-neutral-600 flex items-center gap-4">
                    <span className="text-stone-400 text-xs md:text-sm">房间号</span>
                    <span className="text-xl md:text-2xl text-green-400 font-mono font-bold tracking-widest">{roomId}</span>
                    <button onClick={handleCopy} className="p-2 hover:bg-white/10 rounded transition">
                        {isCopied ? <Check size={18} className="text-green-500"/> : <Copy size={18} className="text-stone-400"/>}
                    </button>
                </div>
            )}

            {/* Role Cards */}
            <div className="flex flex-row gap-4 md:gap-8 mb-8">
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
    <div className={`min-h-screen bg-neutral-900 text-stone-200 flex flex-col items-center font-mono overflow-hidden
        ${isPlaying ? 'justify-start pt-2 md:justify-center md:pt-0' : 'justify-center'}
    `}>
      
      {showRules && renderRules()}
      
      {/* Mobile Controls Overlay */}
      {isMobile && gameState.phase === GamePhase.PLAYING && (
         <MobileControls 
             inputRef={inputRef} 
             onExit={gameMode === GameMode.SINGLE_PLAYER ? () => setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY })) : undefined}
         />
      )}

      {/* Exit Button - Desktop Only */}
      {gameState.phase === GamePhase.PLAYING && gameMode === GameMode.SINGLE_PLAYER && !isMobile && (
        <button 
            onClick={() => setGameState(prev => ({ ...prev, phase: GamePhase.LOBBY }))}
            className="fixed top-6 left-6 z-50 bg-neutral-800/90 hover:bg-red-900/90 text-stone-400 hover:text-white border border-neutral-600 hover:border-red-500 rounded-lg px-4 py-2 flex items-center gap-2 transition-all shadow-xl backdrop-blur-sm font-bold"
        >
            <LogOut size={18} />
            <span className="hidden md:inline">退出</span>
        </button>
      )}

      {/* COMPACT HUD Header for Mobile - Only show in Game */}
      {gameState.phase === GamePhase.PLAYING && (
          <div className="w-full max-w-4xl flex flex-row justify-between items-center mb-1 px-2 py-0.5 bg-neutral-800/90 rounded-xl shadow-lg border border-neutral-700 gap-1 relative z-10 mx-auto mt-1 md:mt-4 backdrop-blur-md">
            {/* Hunter Info */}
            <div className={`flex items-center gap-2 p-1 px-2 rounded-lg transition-colors ${cameraTarget === 'HUNTER' ? 'bg-white/10 ring-1 ring-white/20' : ''}`}>
              <div className="flex flex-col">
                <span className="text-[10px] text-stone-400 leading-tight">猎人</span>
                <div className="flex items-center gap-1 text-red-400 font-bold text-xs md:text-sm">
                  <Gamepad2 size={14} className="md:w-5 md:h-5" />
                  <span>∞</span>
                </div>
              </div>
            </div>

            {/* Time Bar */}
            <div className="flex flex-col items-center flex-1 mx-2 md:mx-4">
              <span className="text-[10px] md:text-xs text-stone-400 mb-0.5 leading-none">
                {gameState.isNight ? "存活" : "入夜"}
              </span>
              <div className="w-full md:w-64 h-2 md:h-3 bg-neutral-700 rounded-full overflow-hidden border border-neutral-600 relative">
                 <div 
                  className={`h-full transition-colors duration-300 ${gameState.isNight ? 'bg-red-900' : 'bg-yellow-500'}`}
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

            {/* Demon Info */}
            <div className={`flex items-center gap-2 text-right p-1 px-2 rounded-lg transition-colors ${cameraTarget === 'DEMON' ? 'bg-white/10 ring-1 ring-white/20' : ''}`}>
              <div className="flex flex-col items-end">
                <span className="text-[10px] text-stone-400 leading-tight">恶魔</span>
                <div className="flex items-center gap-1 text-purple-400 font-bold text-xs md:text-sm">
                   <span>{gameState.isNight ? "猎杀" : "伪装"}</span>
                   <Skull size={14} className="md:w-5 md:h-5" />
                </div>
              </div>
            </div>
            
            {/* Cabin Entry Progress Overlay - Moved to be part of canvas or screen UI */}
            {gameState.hunter.enterTimer > 0 && !gameState.hunter.inCabin && (
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-neutral-900/90 px-3 py-1 rounded border border-yellow-500 text-yellow-500 flex flex-col items-center gap-1 z-50 shadow-xl backdrop-blur">
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
                <div className="absolute top-full mt-2 left-1/2 -translate-x-1/2 bg-green-900/90 px-3 py-1 rounded border border-green-500 text-green-300 flex items-center gap-2 z-50 shadow-xl">
                    <Check size={12}/>
                    <span className="text-[10px] font-bold whitespace-nowrap">已躲入屋内</span>
                </div>
            )}
          </div>
      )}

      {/* Main Content Area */}
      <div className={`relative w-full flex flex-col items-center justify-start ${gameState.phase === GamePhase.PLAYING ? 'px-1' : 'px-4'}`}>
        {gameState.phase === GamePhase.MENU && renderMenu()}
        {gameState.phase === GamePhase.LOBBY && renderLobby()}
        
        {/* Game Canvas & Overlays */}
        {(gameState.phase === GamePhase.PLAYING || 
          gameState.phase === GamePhase.GAME_OVER_HUNTER_WINS || 
          gameState.phase === GamePhase.GAME_OVER_DEMON_WINS) && (
            <div className="relative w-full max-w-[800px] aspect-[4/3]">
                <GameCanvas gameState={gameState} cameraTarget={cameraTarget} />
                
                {gameState.phase !== GamePhase.PLAYING && (
                  <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center rounded-lg z-10 backdrop-blur-sm px-8 text-center">
                    <h1 className="text-2xl md:text-5xl font-bold text-stone-100 mb-2 tracking-widest uppercase text-shadow">
                      游戏结束
                    </h1>
                    <p className="text-md md:text-xl text-stone-300 mb-8 max-w-lg">
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
            </div>
        )}

        {/* Event Log - BELOW Canvas */}
        {gameState.phase === GamePhase.PLAYING && (
            <div className="w-full max-w-4xl mt-1 flex flex-col items-center z-0 px-2 pointer-events-none">
                {gameState.messages.slice(0, 3).map((msg, i) => (
                    <p key={i} className="text-[10px] md:text-sm text-stone-300 mb-1 text-shadow-sm text-center bg-black/50 px-2 py-0.5 rounded border border-white/5 animate-in fade-in slide-in-from-top-1">
                        {msg}
                    </p>
                ))}
            </div>
        )}
      </div>

    </div>
  );
};

export default App;