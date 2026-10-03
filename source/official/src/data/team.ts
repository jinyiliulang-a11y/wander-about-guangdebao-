export interface TeamMember {
  id: string;
  name: string;
  role: string;
  title: string;
  image: string;
  bgColor: string;
  specialties: string[];
  bio: string;
  stats: { label: string; value: string }[];
}

export const teamMembers: TeamMember[] = [
  {
    id: "yang",
    name: "杨开良",
    role: "产品策划 & 市场分析",
    title: "产品与市场",
    image: "/images/team-yang.jpg",
    bgColor: "from-stone-700 to-stone-900",
    specialties: ["产品方案", "市场分析", "创意构思"],
    bio: "天元公学高中在读。在 Trae 线下活动中体验产品经理岗位，产出的产品方案获导师认可；参与临平余杭区创客比赛，自主完成多个小型项目；先后完成抖音店铺运营、电气自动化见习、留学中介三段实习，深谙不同行业的用户痛点，擅长市场分析与创意构思。",
    stats: [
      { label: "实习经历", value: "3 段" },
      { label: "创客项目", value: "多个" },
      { label: "行业洞察", value: "3+" },
    ],
  },
  {
    id: "jin",
    name: "金逸",
    role: "全栈开发 & 技术架构",
    title: "技术开发",
    image: "/images/team-jin.png",
    bgColor: "from-forest-600 to-forest-900",
    specialties: ["前后端开发", "软件架构", "AI 应用"],
    bio: "杭州学军中学桐庐学校，ENFJ。电子数码爱好者，喜爱捣鼓电子产品，拥有软件开发经验，AI 重度依靠者，热爱旅游。负责逛道宝（wander about）的前后端开发。",
    stats: [
      { label: "开发经验", value: "多年" },
      { label: "技术栈", value: "全栈" },
      { label: "AI 工具", value: "重度" },
    ],
  },
  {
    id: "yao",
    name: "姚宇轩",
    role: "艺术设计 & 宣发制作",
    title: "设计与宣发",
    image: "/images/team-yao.jpg",
    bgColor: "from-violet-600 to-purple-800",
    specialties: ["视觉设计", "内容宣发", "创意制作"],
    bio: "09 年生。为逛道宝（wander about）的艺术宣发和制作人员，负责产品视觉呈现、宣传物料设计与内容传播，将产品价值转化为打动人心的视觉语言。",
    stats: [
      { label: "负责板块", value: "艺术宣发" },
      { label: "产出类型", value: "全物料" },
      { label: "创意能力", value: "满级" },
    ],
  },
  {
    id: "fu",
    name: "富明哲",
    role: "数据分析 & 运营",
    title: "数据与运营",
    image: "/images/team-fu.jpg",
    bgColor: "from-slate-600 to-slate-800",
    specialties: ["数据分析", "运营策略", "效率工具"],
    bio: "ESFP，喜欢吃饭，重情义，爱好科技。在 Trae 线下活动中体验过数据分析师岗位；曾帮助本校技术老师在区、市、省的说课比赛中斩获三个第一；WPS 超级大会员拥有者，中国共青团团员。",
    stats: [
      { label: "说课冠军", value: "3 个第一" },
      { label: "数据分析", value: "专业" },
      { label: "效率工具", value: "满级" },
    ],
  },
];
