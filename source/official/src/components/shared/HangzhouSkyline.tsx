interface HangzhouSkylineProps {
  className?: string;
  opacity?: number;
  color?: string;
}

export default function HangzhouSkyline({
  className = "",
  opacity = 0.15,
  color = "#7ab094",
}: HangzhouSkylineProps) {
  return (
    <svg
      width="100%"
      height="160"
      viewBox="0 0 1200 160"
      preserveAspectRatio="none"
      className={className}
      style={{ opacity, color }}
      fill={color}
    >
      {/* 柳枝（右上角） */}
      <g transform="translate(1050, 0)" stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.6">
        <path d="M0,0 Q10,20 5,45 Q0,60 15,70" />
        <path d="M10,0 Q20,15 25,35 Q30,50 20,65" />
        <path d="M20,0 Q25,18 18,38 Q12,52 28,62" />
        <path d="M30,0 Q35,22 28,42 Q22,56 40,68" />
        <path d="M5,20 Q0,22 2,28 Q5,26 5,20" fill="currentColor" />
        <path d="M15,15 Q10,18 12,24 Q16,22 15,15" fill="currentColor" />
        <path d="M25,20 Q20,23 22,29 Q26,27 25,20" fill="currentColor" />
        <path d="M8,35 Q3,38 5,44 Q9,42 8,35" fill="currentColor" />
        <path d="M22,30 Q17,33 19,39 Q23,37 22,30" fill="currentColor" />
      </g>

      {/* 飞鸟 */}
      <g stroke="currentColor" strokeWidth="1.5" fill="none" opacity="0.5">
        <path d="M400,40 Q405,35 410,40 Q415,35 420,40" />
        <path d="M430,50 Q435,46 440,50 Q445,46 450,50" />
        <path d="M460,35 Q464,31 468,35 Q472,31 476,35" />
      </g>

      {/* 月亮 */}
      <circle cx="980" cy="40" r="18" fill="currentColor" opacity="0.4" />

      {/* 左侧树木 */}
      <g transform="translate(30, 90)">
        <path d="M10,40 L10,20 Q5,15 8,8 Q12,2 15,8 Q18,15 13,20 L13,40 Z" />
        <path d="M25,40 L25,15 Q18,10 22,2 Q28,-4 32,2 Q36,10 30,15 L30,40 Z" />
        <rect x="11" y="38" width="3" height="6" />
        <rect x="26" y="36" width="3" height="8" />
      </g>

      {/* 雷峰塔 */}
      <g transform="translate(90, 40)">
        <path d="M30,0 L35,10 L25,10 Z" />
        <path d="M15,10 L45,10 L50,16 L10,16 Z" />
        <rect x="18" y="16" width="24" height="7" />
        <path d="M10,23 L50,23 L55,29 L5,29 Z" />
        <rect x="13" y="29" width="34" height="9" />
        <path d="M5,38 L55,38 L60,44 L0,44 Z" />
        <rect x="8" y="44" width="44" height="11" />
        <path d="M0,55 L60,55 L65,61 L-5,61 Z" />
        <rect x="4" y="61" width="52" height="14" />
        <rect x="-5" y="75" width="70" height="7" />
      </g>

      {/* 雷峰塔右侧矮建筑 */}
      <g transform="translate(190, 70)">
        <rect x="0" y="10" width="20" height="50" />
        <rect x="25" y="20" width="16" height="40" />
        <rect x="45" y="5" width="22" height="55" />
        <path d="M56,0 L56,5 L51,5 L56,0 Z" />
      </g>

      {/* 环球中心（尖顶高楼） */}
      <g transform="translate(320, 20)">
        <rect x="18" y="30" width="24" height="60" />
        <rect x="14" y="20" width="32" height="12" />
        <path d="M30,0 L30,20 L22,20 L30,0 Z" />
        <path d="M30,0 L30,20 L38,20 L30,0 Z" opacity="0.7" />
        <rect x="22" y="40" width="4" height="4" opacity="0.5" />
        <rect x="34" y="40" width="4" height="4" opacity="0.5" />
        <rect x="22" y="50" width="4" height="4" opacity="0.5" />
        <rect x="34" y="50" width="4" height="4" opacity="0.5" />
        <rect x="22" y="60" width="4" height="4" opacity="0.5" />
        <rect x="34" y="60" width="4" height="4" opacity="0.5" />
      </g>

      {/* 环球中心旁边高楼 */}
      <g transform="translate(280, 55)">
        <rect x="0" y="0" width="16" height="50" />
        <rect x="20" y="15" width="14" height="35" />
      </g>
      <g transform="translate(375, 45)">
        <rect x="0" y="5" width="18" height="55" />
        <rect x="22" y="20" width="14" height="40" />
      </g>

      {/* 国际会议中心（大金球） */}
      <g transform="translate(470, 45)">
        <ellipse cx="45" cy="45" rx="45" ry="45" />
        <path d="M0,45 Q45,10 90,45" fill="none" stroke="#0a1230" strokeWidth="0.8" opacity="0.25" />
        <path d="M0,45 Q45,80 90,45" fill="none" stroke="#0a1230" strokeWidth="0.8" opacity="0.25" />
        <path d="M45,0 Q12,45 45,90" fill="none" stroke="#0a1230" strokeWidth="0.8" opacity="0.25" />
        <path d="M45,0 Q78,45 45,90" fill="none" stroke="#0a1230" strokeWidth="0.8" opacity="0.25" />
        <ellipse cx="45" cy="45" rx="45" ry="15" fill="none" stroke="#0a1230" strokeWidth="0.8" opacity="0.2" />
        <rect x="35" y="87" width="20" height="6" />
        <rect x="25" y="93" width="40" height="4" />
      </g>

      {/* 杭州大剧院（月亮） */}
      <g transform="translate(590, 55)">
        <path d="M0,40 Q20,5 55,20 Q32,35 35,55 Q35,72 12,62 Q2,55 0,40 Z" />
      </g>

      {/* 市民中心（方块建筑群） */}
      <g transform="translate(700, 55)">
        <rect x="0" y="10" width="30" height="50" />
        <rect x="35" y="0" width="35" height="60" />
        <rect x="75" y="15" width="28" height="45" />
        <rect x="108" y="8" width="32" height="52" />
        <rect x="145" y="18" width="25" height="42" />
        <rect x="48" y="-5" width="9" height="8" />
      </g>

      {/* 奥体莲花碗 */}
      <g transform="translate(900, 50)">
        <path d="M10,55 Q10,30 35,20 Q60,10 85,20 Q110,30 110,55 L105,60 L15,60 Z" />
        <path d="M15,30 Q20,12 30,25 Q35,8 45,22 Q50,5 60,20 Q65,8 75,25 Q85,12 90,30 L85,38 L20,38 Z" />
        <rect x="35" y="58" width="50" height="8" />
        <rect x="25" y="64" width="70" height="4" />
      </g>

      {/* 最右侧建筑 */}
      <g transform="translate(1060, 60)">
        <rect x="0" y="15" width="22" height="45" />
        <rect x="26" y="5" width="18" height="55" />
        <rect x="48" y="20" width="16" height="40" />
        <rect x="68" y="10" width="24" height="50" />
        <rect x="96" y="25" width="14" height="35" />
        <rect x="114" y="8" width="20" height="52" />
      </g>

      {/* 西湖水面弧形 */}
      <path d="M0,130 Q300,110 600,125 Q900,140 1200,120 L1200,160 L0,160 Z" fill="currentColor" opacity="0.4" />
      <path d="M0,140 Q400,125 800,135 Q1000,142 1200,132 L1200,160 L0,160 Z" fill="currentColor" opacity="0.25" />
    </svg>
  );
}
