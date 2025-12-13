
import React, { useState } from 'react';
import { X, Link, ArrowRight, Loader2, Info } from 'lucide-react';

interface JoinModalProps {
  onClose: () => void;
  onJoin: (id: string) => void;
  isConnecting: boolean;
  error: string;
}

export const JoinModal: React.FC<JoinModalProps> = ({ onClose, onJoin, isConnecting, error }) => {
  const [inputCode, setInputCode] = useState('');

  return (
    <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-neutral-800 border border-stone-600 rounded-lg max-w-md w-full p-8 relative shadow-2xl flex flex-col items-center gap-6">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-400 hover:text-white disabled:opacity-50 transition-colors"
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
              ${error ? 'border-red-500 focus:ring-red-500/50' : 'border-stone-700 focus:border-blue-500 focus:ring-blue-500/50'}`}
            onChange={(e) => setInputCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 6))}
            value={inputCode}
            maxLength={6}
            disabled={isConnecting}
          />
          {error && (
            <span className="text-sm text-red-500 font-bold text-center animate-pulse flex items-center justify-center gap-1">
              <Info size={14}/> {error}
            </span>
          )}
        </div>

        <button 
          onClick={() => onJoin(inputCode)}
          disabled={isConnecting || inputCode.length < 4}
          className={`w-full py-4 text-white rounded-lg font-bold text-lg shadow-lg flex items-center justify-center gap-2 transition-all
            ${isConnecting || inputCode.length < 4
              ? 'bg-stone-600 cursor-not-allowed' 
              : 'bg-blue-600 hover:bg-blue-500 hover:shadow-blue-500/20 active:scale-95'}`}
        >
          {isConnecting ? <Loader2 className="animate-spin" /> : <ArrowRight size={20} />} 
          {isConnecting ? "连接中..." : "连接房间"}
        </button>
      </div>
    </div>
  );
};
