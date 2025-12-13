
import React from 'react';
import { Users, BookOpen, Check, Copy, Play, Info, Gamepad2, Skull, UserPlus, User, Signal } from 'lucide-react';
import { EntityType, GameMode, OpponentMode } from '../../types';

interface LobbyProps {
  gameMode: GameMode;
  roomId: string;
  myRole: EntityType;
  opponentMode: OpponentMode;
  latency: number | null;
  onCopy: () => void;
  isCopied: boolean;
  onShowRules: () => void;
  onBack: () => void;
  onStart: () => void;
  onSetRole: (role: EntityType) => void;
  onSetOpponentMode: (mode: OpponentMode) => void;
}

export const Lobby: React.FC<LobbyProps> = ({
  gameMode,
  roomId,
  myRole,
  opponentMode,
  latency,
  onCopy,
  isCopied,
  onShowRules,
  onBack,
  onStart,
  onSetRole,
  onSetOpponentMode
}) => {
  const isGuest = gameMode === GameMode.ONLINE_CLIENT;
  const isOnline = gameMode === GameMode.ONLINE_HOST || gameMode === GameMode.ONLINE_CLIENT;

  const renderCard = (role: EntityType) => {
    const isMyRole = myRole === role;
    let statusText = "空缺";
    let statusColor = "text-stone-500";
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
        className={`relative flex flex-col items-center justify-center p-4 w-36 h-48 md:w-48 md:h-64 border-2 rounded-xl transition-all duration-300
          ${isMyRole ? 'border-green-500 bg-green-900/20 shadow-[0_0_15px_rgba(34,197,94,0.3)]' : 'border-stone-700 bg-stone-800/50'}
          ${canSwitchRole ? 'cursor-pointer hover:border-stone-500 hover:scale-105' : ''}
        `}
        onClick={() => {
          if (canSwitchRole) {
            onSetRole(role);
          }
        }}
      >
        <div className={`mb-4 p-4 rounded-full transition-transform duration-300 ${isMyRole ? 'scale-110' : ''} ${role === EntityType.HUNTER ? 'bg-red-500/20 text-red-500' : 'bg-purple-500/20 text-purple-500'}`}>
          {role === EntityType.HUNTER ? <Gamepad2 size={48}/> : <Skull size={48}/>}
        </div>
        <h3 className="text-lg md:text-xl font-bold uppercase mb-2 text-stone-200">{role === EntityType.HUNTER ? '猎人' : '恶魔'}</h3>
        <span className={`text-xs md:text-sm font-bold ${statusColor}`}>{statusText}</span>

        {canAddCpu && (
          <button 
            className="mt-4 px-3 py-1 bg-stone-700 hover:bg-stone-600 rounded text-xs flex items-center gap-1 z-10 transition-colors"
            onClick={(e) => { e.stopPropagation(); onSetOpponentMode('COMPUTER'); }}
          >
            <UserPlus size={14}/> <span className="hidden md:inline">电脑</span>
          </button>
        )}
        {canRemoveCpu && (
          <button 
            className="mt-4 px-3 py-1 bg-red-900/50 hover:bg-red-900 text-red-200 rounded text-xs flex items-center gap-1 z-10 transition-colors"
            onClick={(e) => { e.stopPropagation(); onSetOpponentMode('WAITING'); }}
          >
            <User size={14}/> <span className="hidden md:inline">移除</span>
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="bg-neutral-800 p-4 md:p-8 rounded-lg border border-neutral-700 w-full max-w-4xl flex flex-col items-center relative my-auto animate-in fade-in slide-in-from-bottom-4 shadow-2xl">
      <h2 className="text-2xl md:text-3xl font-bold text-stone-200 mb-6 flex items-center gap-3">
        <Users /> 选择角色 {isOnline && <span className="text-xs text-blue-400 bg-blue-900/30 px-2 py-1 rounded border border-blue-500/30">在线模式</span>}
      </h2>

      <button 
        onClick={onShowRules}
        className="absolute top-4 right-4 md:top-8 md:right-8 text-stone-400 hover:text-green-400 flex items-center gap-2 transition"
      >
        <BookOpen size={20} /> <span className="hidden sm:inline">规则</span>
      </button>

      {/* Room Info */}
      {gameMode === GameMode.ONLINE_HOST && (
        <div className="mb-6 px-4 py-2 bg-neutral-900 rounded border border-neutral-600 flex items-center gap-4 shadow-inner">
          <span className="text-stone-400 text-xs md:text-sm">房间号</span>
          <span className="text-xl md:text-2xl text-green-400 font-mono font-bold tracking-widest">{roomId}</span>
          <button onClick={onCopy} className="p-2 hover:bg-white/10 rounded transition">
            {isCopied ? <Check size={18} className="text-green-500"/> : <Copy size={18} className="text-stone-400"/>}
          </button>
        </div>
      )}
      
      {/* Latency / Ping */}
      {opponentMode === 'CONNECTED' && latency !== null && (
        <div className="absolute top-4 left-4 md:top-8 md:left-8 flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full border border-white/10">
          <Signal size={16} className={latency < 100 ? "text-green-500" : latency < 200 ? "text-yellow-500" : "text-red-500"} />
          <div className="flex flex-col">
            <span className="text-stone-400 text-[10px] font-bold leading-none uppercase">Ping</span>
            <span className="text-stone-200 text-xs font-mono leading-none">{latency}ms</span>
          </div>
        </div>
      )}

      {/* Role Cards */}
      <div className="flex flex-row gap-4 md:gap-12 mb-8">
        {renderCard(EntityType.HUNTER)}
        <div className="hidden md:flex items-center text-stone-600 font-bold text-xl">VS</div>
        {renderCard(EntityType.DEMON)}
      </div>

      {/* Action Bar */}
      <div className="flex gap-4 w-full max-w-md">
        <button 
          onClick={onBack}
          className="flex-1 py-3 border border-stone-600 text-stone-400 rounded hover:bg-stone-700 transition font-bold"
        >
          返回
        </button>
        
        {gameMode === GameMode.SINGLE_PLAYER ? (
          <button 
            onClick={onStart}
            className="flex-1 py-3 font-bold rounded flex items-center justify-center gap-2 transition bg-green-600 text-white hover:bg-green-500 shadow-lg hover:shadow-green-500/20 active:scale-95"
          >
            <Play size={18} /> 开始游戏
          </button>
        ) : (
          <button 
            onClick={onStart}
            disabled={isGuest || (gameMode === GameMode.ONLINE_HOST && opponentMode !== 'CONNECTED')}
            className={`flex-1 py-3 font-bold rounded flex items-center justify-center gap-2 transition active:scale-95
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
    </div>
  );
};
