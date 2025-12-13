
import React from 'react';
import { X, BookOpen, Gamepad2, Skull } from 'lucide-react';

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
              <li><span className="text-red-500 font-bold">夜晚 (40秒)</span>: 恶魔现出原形，视野变小但速度极快。猎人无法在夜晚彻底杀死恶魔，只能将其<strong>击晕0.5秒</strong>。</li>
            </ul>
          </section>

          <section>
            <h3 className="text-xl font-bold text-white mb-2 border-b border-stone-700 pb-1">3. 关键道具 & 技能</h3>
            <ul className="list-disc list-inside space-y-2 text-sm">
              <li><strong>木屋</strong>: 地图中央的安全区。猎人在门前停留5秒可进入，进入后夜晚无敌。</li>
              <li><strong>蘑菇</strong>: 散落在地图各处。恶魔吃掉蘑菇会显著加速时间流逝（加速入夜）。</li>
              <li><span className="text-purple-400 font-bold">恶魔追踪</span>: 夜晚时，恶魔可以使用一次交互键来感知猎人的方位（显示红色箭头）。</li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
};
