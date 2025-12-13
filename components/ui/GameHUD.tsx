
import React from 'react';
import { GameState } from '../../types';
import { Gamepad2, Skull, LockKeyhole, Check } from 'lucide-react';
import { NIGHT_DURATION_SECONDS, DAY_DURATION_SECONDS, CABIN_ENTER_DURATION } from '../../constants';

interface GameHUDProps {
  gameState: GameState;
  cameraTarget: 'HUNTER' | 'DEMON';
}

export const GameHUD: React.FC<GameHUDProps> = ({ gameState, cameraTarget }) => {
  return (
    <div className="absolute top-2 left-1/2 -translate-x-1/2 w-full max-w-4xl flex flex-col items-center px-4 py-1 z-20 pointer-events-none gap-2">
      {/* Top Bar */}
      <div className="flex flex-row justify-between items-center w-full bg-neutral-900/60 backdrop-blur-md rounded-xl p-1 border border-white/5 shadow-2xl">
        {/* Hunter Info */}
        <div className={`flex items-center gap-2 p-1 px-3 rounded-lg transition-colors ${cameraTarget === 'HUNTER' ? 'bg-white/10 ring-1 ring-white/20' : ''}`}>
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

        {/* Demon Info */}
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
      
      {/* Action Progress Overlay */}
      {gameState.hunter.enterTimer > 0 && !gameState.hunter.inCabin && (
        <div className="mt-8 bg-neutral-900/90 px-3 py-1 rounded border border-yellow-500 text-yellow-500 flex flex-col items-center gap-1 shadow-xl backdrop-blur animate-in fade-in zoom-in duration-200">
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

      {/* State Badge */}
      {gameState.hunter.inCabin && (
        <div className="mt-8 bg-green-900/90 px-3 py-1 rounded border border-green-500 text-green-300 flex items-center gap-2 shadow-xl animate-in fade-in slide-in-from-top-2">
          <Check size={12}/>
          <span className="text-[10px] font-bold whitespace-nowrap">已躲入屋内</span>
        </div>
      )}
    </div>
  );
};
