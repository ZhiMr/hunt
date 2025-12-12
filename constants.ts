export const MAP_SIZE = 1200;
export const VIEWPORT_WIDTH = 800;
export const VIEWPORT_HEIGHT = 600;
export const RENDER_SCALE = 2.0; // Render at 2x resolution for High DPI/Sharper look

export const MOVE_SPEED_HUNTER = 2.2; // Slowed down from 3.5
export const MOVE_SPEED_DEMON = 2.5; // Slowed down from 4.0
export const MOVE_SPEED_DEER = 1.0; // Slowed down from 1.5

export const DAY_DURATION_SECONDS = 180; // Extended to 180 seconds
export const NIGHT_DURATION_SECONDS = 40; // Night lasts 40 seconds
export const FPS = 60;
export const DAY_DURATION_TICKS = FPS * DAY_DURATION_SECONDS; 
export const NIGHT_THRESHOLD = 1.0;

export const VISION_RADIUS_DAY = 350;
export const VISION_RADIUS_NIGHT = 200;
export const VISION_RADIUS_DIM = 600; // How far we can see terrain
export const TREE_COLLISION_RATIO = 0.35; // Tree trunk size relative to visual size

export const BULLET_SPEED = 8; // Reduced from 12
export const SHOOT_COOLDOWN = 60; // Frames
export const MAX_BULLETS = Infinity; // Infinite ammo
export const SHOOT_PENALTY_SECONDS = 12; // Adjusted to 12 seconds cost per shot
export const DEMON_STUN_DURATION = 0.5; // Seconds demon is stunned if shot at night
export const DEMON_TRACKING_DURATION = 1.0; // Seconds the tracking arrow is visible

// 12 seconds out of 180 seconds
export const DEMON_EAT_BONUS = 12 / DAY_DURATION_SECONDS; 

export const CABIN_ENTER_DURATION = 5; // Seconds to enter cabin

export const COLORS = {
  GROUND_DAY: '#4ade80', // green-400
  GROUND_NIGHT: '#14532d', // green-900
  TREE: '#1e293b', // slate-800
  CABIN: '#78350f', // amber-900
  DEER: '#a8a29e', // stone-400
  HUNTER: '#ef4444', // red-500
  DEMON_DAY: '#a8a29e', // Matches Deer
  DEMON_NIGHT: '#7f1d1d', // red-900
  MUSHROOM: '#d946ef', // fuchsia-500
  FOG: '#000000',
};