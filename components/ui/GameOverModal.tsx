
import React from 'react';
import { GamePhase } from '../../types';
import { RefreshCw } from 'lucide-react';

interface GameOverModalProps {
  phase: GamePhase;
  onRestart: () => void;
}

export const GameOverModal: React.FC<GameOverModalProps> = ({ phase, onRestart }) => {
  return (
    <div className="absolute inset-0 bg-black/90 flex flex-col items-center justify-center rounded-lg z-30 backdrop-blur-sm px-8 text-center border-2 border-stone-800 animate-in fade-in zoom-in duration-500">
      <h1 className="text-2xl md:text-5xl font-bold text-stone-100 mb-2 tracking-widest uppercase text-shadow-lg">
        游戏结束
      </h1>
      <p className="text-md md:text-xl text-stone-300 mb-8 max-w-lg">
        {phase === GamePhase.GAME_OVER_HUNTER_WINS && <span className="text-green-400 font-bold">猎人净化了森林中的邪恶！</span>}
        {phase === GamePhase.GAME_OVER_DEMON_WINS && <span className="text-red-500 font-bold">森林吞噬了又一个灵魂...</span>}
      </p>
      
      <button 
        onClick={onRestart}
        className="flex items-center gap-2 px-8 py-3 bg-stone-100 text-neutral-900 font-bold rounded hover:bg-white hover:scale-105 transition-all mb-8 pointer-events-auto shadow-lg"
      >
        <RefreshCw size={20} /> 返回大厅
      </button>
    </div>
  );
};
