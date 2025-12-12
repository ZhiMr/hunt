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
  MUSHROOM = 'MUSHROOM'
}

export interface Entity {
  id: string;
  type: EntityType;
  pos: Vector2;
  size: number; // Radius or half-width
  angle: number; // Rotation in radians
  // Optional AI state for Deer
  aiState?: {
    moving: boolean;
    timer: number;
  };
}

export interface Player extends Entity {
  velocity: Vector2;
  cooldown: number;
}

export interface Hunter extends Player {
  bullets: number;
  inCabin: boolean; // Is safe inside cabin
  enterTimer: number; // Time spent waiting at door
}

export interface Demon extends Player {
  energy: number; // Consumed to speed up night
  isRevealed: boolean; // True at night
  stunTimer: number; // Time remaining stunned (in seconds)
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
  mushrooms: Entity[];
  bullets: Array<{ pos: Vector2; velocity: Vector2; active: boolean }>;
  cabin: Entity;
  mapWidth: number;
  mapHeight: number;
  lastShotTime: number;
  messages: string[]; // Recent game events
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

export type NetworkMessage = 
  | { type: 'STATE_UPDATE'; state: GameState }
  | { type: 'INPUT_UPDATE'; input: PlayerInput }
  | { type: 'PLAYER_JOINED'; role: PlayerRole }
  | { type: 'START_GAME' };