import React from 'react';
import { X, BookOpen, Gamepad2, Skull, Keyboard, Timer, ShieldAlert } from 'lucide-react';

interface RulesModalProps {
  onClose: () => void;
}

export const RulesModal: React.FC<RulesModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/80 z-[110] flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-neutral-800 border border-stone-600 rounded-lg max-w-2xl w-full p-6 relative shadow-2xl overflow-y-auto max-h-[90vh]">
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 text-stone-400 hover:text-white transition-colors"
        >
          <X size={24} />
        </button>
        
        <h2 className="text-3xl font-bold text-green-400 mb-6 flex items-center gap-2">
          <BookOpen /> 游戏指南
        </h2>

        <div className="space-y-6 text-stone-300">
          
          {/* Controls Section */}
          <section>
             <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1 flex items-center gap-2">
                <Keyboard size={20}/> 操作按键
             </h3>
             <div className="grid grid-cols-2 gap-4 text-sm bg-stone-900/50 p-3 rounded">
                <div>
                   <span className="text-stone-400 block mb-1">移动</span>
                   <strong className="text-white text-lg">WASD</strong> <span className="text-stone-500 text-xs">或</span> <strong className="text-white text-lg">方向键</strong>
                </div>
                <div>
                   <span className="text-stone-400 block mb-1">攻击 / 交互</span>
                   <strong className="text-white text-lg">空格</strong> <span className="text-stone-500 text-xs">或</span> <strong className="text-white text-lg">回车</strong>
                </div>
             </div>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1">角色目标</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-red-900/20 p-4 rounded border border-red-900/50">
                <h4 className="font-bold text-red-400 mb-2 flex items-center gap-2"><Gamepad2 size={18}/> 猎人</h4>
                <ul className="list-disc list-inside text-sm space-y-1.5 text-stone-300">
                   <li><strong>白天</strong>: 辨认并射杀伪装的恶魔。</li>
                   <li><strong>夜晚</strong>: 躲避追杀，存活至黎明。</li>
                   <li className="text-xs text-stone-400 pt-1 border-t border-red-900/30 mt-1">注意: 开枪会消耗时间，加速入夜。</li>
                </ul>
              </div>
              <div className="bg-purple-900/20 p-4 rounded border border-purple-900/50">
                <h4 className="font-bold text-purple-400 mb-2 flex items-center gap-2"><Skull size={18}/> 恶魔</h4>
                <ul className="list-disc list-inside text-sm space-y-1.5 text-stone-300">
                   <li><strong>白天</strong>: 伪装成鹿，吃蘑菇加速入夜。</li>
                   <li><strong>夜晚</strong>: 现出真身，猎杀猎人。</li>
                   <li className="text-xs text-stone-400 pt-1 border-t border-purple-900/30 mt-1">注意: 夜晚可使用技能感知猎人位置。</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1 flex items-center gap-2">
                <Timer size={20} /> 昼夜机制
            </h3>
            <div className="text-sm space-y-3 bg-stone-900/30 p-3 rounded">
               <p><span className="text-yellow-400 font-bold block mb-1">☀️ 白天 (180s)</span> 猎人视野开阔，恶魔混在鹿群中。双方的主动行为(开枪/吃蘑菇)会加速时间流逝。</p>
               <p><span className="text-red-500 font-bold block mb-1">🌙 夜晚 (40s)</span> 恶魔移速剧增，猎人视野受限。猎人无法杀死恶魔，只能将其击晕。恶魔获得追踪能力。</p>
            </div>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1 flex items-center gap-2">
                <ShieldAlert size={20} /> 庇护所
            </h3>
            <p className="text-sm text-stone-300">
                地图中央的<strong>木屋</strong>是猎人的唯一避难所。在门前停留 <span className="text-white font-bold">5秒</span> 可进入，进入后<strong>无敌</strong>直到天亮。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
};