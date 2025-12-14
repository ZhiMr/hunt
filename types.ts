
export enum GamePhase {
  MENU = 'MENU',
  LOBBY = 'LOBBY',
  JOINING = 'JOINING',
  START = 'START',
  PLAYING = 'PLAYING',
  GAME_OVER_HUNTER_WINS = 'GAME_OVER_HUNTER_WINS',
  GAME_OVER_DEMON_WINS = 'GAME_OVER_DEMON_WINS'
}

export type Vector2 = { x: number; y: number };

export enum EntityType {
  HUNTER = 'HUNTER',
  DEMON = 'DEMON',
  DEER = 'DEER',
  TREE = 'TREE',
  CABIN = 'CABIN',
  MUSHROOM = 'MUSHROOM',
  BUSH = 'BUSH'
}

export interface DeerAIState {
  moving: boolean;
  timer: number;
}

export interface HunterAIState {
  mode: 'IDLE' | 'PATROL' | 'CHASE' | 'RETURN_CABIN';
  targetPos: Vector2 | null;
  waitTimer: number;
  stuckTimer: number;      // New: Tracks how long hunter has been stationary while trying to move
  lastPos: Vector2 | null; // New: Tracks last position to calculate movement delta
}

export interface DemonAIState {
  mode: 'PATROL' | 'CHASE' | 'INVESTIGATE';
  targetPos: Vector2 | null;
  timer: number;
  lastPatrolPoint: Vector2 | null; // Used to pick next point far away from previous
}

export interface Entity {
  id: string;
  type: EntityType;
  pos: Vector2;
  size: number; // Radius or half-width
  angle: number; // Rotation in radians
  // Optional AI state
  aiState?: DeerAIState | HunterAIState | DemonAIState;
}

export interface Player extends Entity {
  velocity: Vector2;
  cooldown: number;
}

export interface Hunter extends Player {
  bullets: number;
  inCabin: boolean; // Is safe inside cabin
  enterTimer: number; // Time spent waiting at door
  aiState?: HunterAIState;
}

export interface Demon extends Player {
  energy: number; // Consumed to speed up night
  isRevealed: boolean; // True at night
  stunTimer: number; // Time remaining stunned (in seconds)
  trackingActiveTime: number; // How long the tracking arrow is visible
  canTrack: boolean; // Whether the one-time night tracking is available
  aiState?: DemonAIState;
}

export interface GameMessage {
  id: number;
  text: string;
  timeLeft: number;
}

export interface GameState {
  phase: GamePhase;
  timeOfDay: number; // 0 to 1, where 0 is dawn, 0.5 is noon, 1 is night trigger
  isNight: boolean;
  nightTimer: number; // Seconds spent in night
  hunter: Hunter;
  demon: Demon;
  deers: Entity[];
  trees: Entity[];
  bushes: Entity[];
  mushrooms: Entity[];
  bullets: Array<{ pos: Vector2; velocity: Vector2; active: boolean }>;
  cabin: Entity;
  mapWidth: number;
  mapHeight: number;
  lastShotTime: number;
  messages: GameMessage[]; // Recent game events with timer
}

// Separate inputs for better networking/AI control
export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  action: boolean; // Space or Enter
  action2?: boolean;
}

export interface InputState {
  // Legacy monolithic input, kept for compatibility if needed, but we will move to decoupled inputs
  w: boolean; a: boolean; s: boolean; d: boolean; space: boolean;
  up: boolean; left: boolean; down: boolean; right: boolean; enter: boolean;
}

// Multiplayer Types
export enum PlayerRole {
  HOST = 'HOST', // Usually Hunter
  CLIENT = 'CLIENT', // Usually Demon
  SPECTATOR = 'SPECTATOR'
}

export enum GameMode {
  LOCAL_COOP = 'LOCAL_COOP', // WASD + Arrows on same screen
  SINGLE_PLAYER = 'SINGLE_PLAYER', // WASD vs AI
  ONLINE_HOST = 'ONLINE_HOST', // Host vs Remote Client
  ONLINE_CLIENT = 'ONLINE_CLIENT' // Client vs Remote Host
}

export type OpponentMode = 'WAITING' | 'COMPUTER' | 'CONNECTED';

export type NetworkMessage = 
  | { type: 'STATE_UPDATE'; state: GameState }
  | { type: 'INPUT_UPDATE'; input: PlayerInput }
  | { type: 'PLAYER_JOINED'; role: PlayerRole }
  | { type: 'LOBBY_UPDATE'; hostRole: EntityType }
  | { type: 'START_GAME'; clientRole: EntityType; initialState: GameState }
  | { type: 'PING'; timestamp: number }
  | { type: 'PONG'; timestamp: number };
