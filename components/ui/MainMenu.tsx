
import React from 'react';
import { Monitor, Users, Link } from 'lucide-react';
import { MenuBackground } from '../MenuBackground';

interface MainMenuProps {
  onSinglePlayer: () => void;
  onHostGame: () => void;
  onJoinGame: () => void;
}

export const MainMenu: React.FC<MainMenuProps> = ({ onSinglePlayer, onHostGame, onJoinGame }) => {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden">
      {/* Background Layer */}
      <MenuBackground />

      {/* Content Layer */}
      <div className="z-10 flex flex-col gap-4 items-center animate-in fade-in zoom-in duration-500 bg-black/40 p-12 rounded-2xl backdrop-blur-sm border border-white/10 shadow-2xl">
        <h1 className="text-4xl md:text-5xl font-bold text-green-400 mb-8 tracking-tighter text-center text-shadow-lg">
          森林低语
        </h1>
        
        <button 
          onClick={onSinglePlayer}
          className="w-64 py-4 bg-stone-100 text-stone-900 font-bold rounded hover:scale-105 transition flex items-center justify-center gap-2 shadow-lg hover:shadow-green-500/20"
        >
          <Monitor size={20}/> 本地游戏 / 单人
        </button>

        <button 
          onClick={onHostGame}
          className="w-64 py-4 bg-stone-800 text-stone-200 border border-stone-600 font-bold rounded hover:scale-105 transition flex items-center justify-center gap-2 shadow-lg hover:border-stone-500 hover:shadow-blue-500/20"
        >
          <Users size={20}/> 创建在线房间
        </button>

        <button 
          onClick={onJoinGame}
          className="w-64 py-4 bg-stone-800 text-stone-200 border border-stone-600 font-bold rounded hover:scale-105 transition flex items-center justify-center gap-2 shadow-lg hover:border-stone-500 hover:shadow-purple-500/20"
        >
          <Link size={20}/> 加入在线房间
        </button>
      </div>
      
      <div className="absolute bottom-4 text-xs text-stone-400 z-10 opacity-60 hover:opacity-100 transition-opacity cursor-default">
        v1.0.1 • 猎人 vs 恶魔
      </div>
    </div>
  );
};