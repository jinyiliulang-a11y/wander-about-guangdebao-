export interface Feature { icon: string; title: string; description: string }
export interface Innovation { tag: string; title: string; description: string }
export interface TechSpec { label: string; value: string; detail: string }
export interface PainPoint { target: string; title: string; desc: string }
export interface MarketTrend { value: string; label: string; desc: string }
export interface ValueProposition { title: string; desc: string }
export interface CoreFeatureDetail extends Feature { implement: string; userValue: string }
export interface RevenueModel { title: string; desc: string }
export interface PromotionStrategy { phase: string; title: string; desc: string }
export interface CooperationModel { role: string; responsibility: string; benefit: string }
export interface OperationSystem { title: string; desc: string }
export interface RiskControl { risk: string; solution: string }

export const coreFeatureDetails: CoreFeatureDetail[] = [
 { icon: "map", title: "地图与分级线索", description: "从地图选择宝藏，通过线索一步步发现门店里的目标。", implement: "查看任务、分级线索与门店位置；商家配置门店范围后，可进行到店校验。", userValue: "让路过变成主动探索，也让不熟悉的门店有机会被发现。" },
 { icon: "coin", title: "金币 NFC 与领取申请", description: "碰一碰金币 NFC，打开对应任务的领取入口。", implement: "到店校验通过后保存领取申请。金币设备码用于商家识别设备，可重复使用；扫描设备码不会自动发券。", userValue: "先保存发现，再由商家核对领取，减少对领奖步骤的误解。" },
 { icon: "users", title: "寻宝者与探索者", description: "同一位玩家既可以寻找宝藏，也可以创作线索。", implement: "在客户端切换体验模式，创作内容并提交审核；商家和运营的权限由账号授权决定。", userValue: "把个人发现变成下一位玩家的探索起点。" },
 { icon: "ticket", title: "奖励确认与卡包", description: "找到金币后，交由商家核对并确认奖励。", implement: "商家识别金币设备、核对玩家并接收实物后确认奖励。正式券进入卡包；积分记入账户，无需核销。", userValue: "清楚区分领取申请、正式奖励和日后的使用。" },
 { icon: "shield", title: "个人券核销", description: "消费时出示个人优惠券二维码，由商家办理核销。", implement: "商家扫描个人券并核对状态；已核销优惠券不能重复使用。此二维码与金币设备码承担不同用途。", userValue: "奖励领取与消费核销各有清晰凭证。" },
 { icon: "chart", title: "商家与运营工作台", description: "把任务、奖励、审核与记录放在各自的工作台。", implement: "商家维护优惠券库存、金币绑定、门店范围、活动及领奖核销记录；运营管理账号申请、门店、内容审核和游戏设置。", userValue: "用实际记录检查活动进展，为后续试点复盘提供依据。" }
];
export const coreFeatures: Feature[] = coreFeatureDetails.map(({icon,title,description}) => ({icon,title,description}));
export const innovations: Innovation[] = [
 { tag: "参与方式", title: "用户也能成为创作者", description: "寻宝与创作两种模式可以切换，已有内容通过审核后进入探索体验。" },
 { tag: "探索路径", title: "线索连接真实门店", description: "地图、分级线索与金币 NFC 串起一次线下探索。" },
 { tag: "奖励方式", title: "让奖励成为发现的成果", description: "领取申请由商家确认，正式优惠券供用户日后到店消费时使用。" },
 { tag: "门店协作", title: "领取与核销分开办理", description: "设备码识别金币，个人券二维码核销权益，两个阶段都有对应记录。" }
];
export const techSpecs: TechSpec[] = [
 { label: "位置校验", value: "门店范围", detail: "圆形门店范围可配置，实际定位效果受设备和现场环境影响。" },
 { label: "协作方式", value: "三端协作", detail: "客户端、商家端与运营端使用共享后端。" },
 { label: "金币体系", value: "设备识别", detail: "金币设备码可重复识别；正式个人券单独核销。" },
 { label: "权限", value: "账号授权", detail: "玩家、商家和运营账号分别授权；客户端模式切换不改变后台权限。" },
 { label: "效果评估", value: "试点复盘", detail: "根据实际领奖与核销记录评估活动，不预设增长比例。" },
 { label: "落地准备", value: "现场验收", detail: "正式使用前确认 HTTPS、定位、设备绑定与门店履约流程。" }
];
export const scenarios = [
 {title:"购物中心",desc:"围绕门店线索组织探索路线，连接不同楼层与业态。",icon:"building-2"},
 {title:"商圈街区",desc:"结合街区环境设计探索点位，试点前核对范围与安全路线。",icon:"map-pinned"},
 {title:"品牌门店",desc:"用门店自己的内容与权益，邀请用户完成一次小探索。",icon:"store"}
];
export const caseStudy = {mall:"小范围试点计划",period:"效果需实际试点验证",metrics:[
 {label:"参与情况",value:"待采集",desc:"按真实活动记录统计"},
 {label:"券使用情况",value:"待复盘",desc:"区分已领取与已核销"},
 {label:"现场体验",value:"待验收",desc:"检查定位、金币与履约流程"},
 {label:"迭代依据",value:"用户反馈",desc:"记录线索与操作中的实际问题"}
]};
export const painPoints: PainPoint[] = [
 {target:"商场",title:"活动容易趋同",desc:"希望在折扣之外，为用户增加一次值得参与的线下体验。"},
 {target:"商家",title:"门店需要被发现",desc:"用门店自己的线索吸引探索，让路线经过更多店铺。"},
 {target:"玩家",title:"逛街想多一点趣味",desc:"在熟悉的街区发现细节，让寻找与获得奖励都有参与感。"}
];
export const marketTrends: MarketTrend[] = [
 {value:"探索",label:"线下参与",desc:"用可完成的小任务，邀请用户走进真实门店。"},
 {value:"共创",label:"内容参与",desc:"用户可以提交自己的线索，由运营审核。"},
 {value:"奖励",label:"门店连接",desc:"由商家确认领取，正式个人券日后核销。"},
 {value:"复盘",label:"活动改进",desc:"以真实记录与现场反馈改进玩法。"}
];
export const valuePropositions: ValueProposition[] = [
 {title:"为到店增加一个理由",desc:"围绕门店线索、金币与权益设计探索，引导用户主动寻找。"},
 {title:"让领取与使用更清楚",desc:"领取申请、商家确认、正式卡包与消费核销分别有对应步骤。"},
 {title:"让内容来自更多发现",desc:"探索者提交线索，审核后供寻宝者体验。"},
 {title:"根据真实记录持续改进",desc:"用领奖、核销与用户反馈检查活动效果，不预设商业增长结果。"}
];
export const revenueModels: RevenueModel[] = [
 {title:"主题活动服务（规划）",desc:"结合场地和门店设计活动内容，实际服务范围按试点需求确定。"},
 {title:"商家增值服务（规划）",desc:"在验证活动价值后，探索内容支持与运营服务。"},
 {title:"品牌联动（规划）",desc:"跨门店活动与会员联动需要另行接入和验证。"}
];
export const promotionStrategies: PromotionStrategy[] = [
 {phase:"01",title:"选定场地与门店",desc:"先确定少量参与门店、可公开到达的探索区域和奖励条件。"},
 {phase:"02",title:"配置与现场验收",desc:"核对门店范围、金币入口、设备绑定、库存、手机权限及 HTTPS 环境。"},
 {phase:"03",title:"小范围试运行",desc:"用真实手机走通寻宝、领取申请、商家确认与个人券核销。"},
 {phase:"04",title:"按记录与反馈迭代",desc:"复盘实际参与、领奖、核销和操作问题，再决定扩大范围。"}
];
export const cooperationModels: CooperationModel[] = [
 {role:"场地与商场",responsibility:"提供安全探索区域，协调参与门店与活动规则",benefit:"以试点记录评估参与和到店情况"},
 {role:"门店",responsibility:"配置权益、管理金币、确认奖励并履行核销",benefit:"了解本店奖励领取和使用情况"},
 {role:"逛道宝团队",responsibility:"维护产品、内容流程并支持现场验收",benefit:"依据实际反馈持续改进体验"}
];
export const operationSystems: OperationSystem[] = [
 {title:"内容审核",desc:"探索者提交任务，运营审核并维护发布状态。"},
 {title:"门店配置",desc:"核对优惠券库存、门店范围、金币设备和对应任务。"},
 {title:"活动记录",desc:"商家查看本店领奖与核销记录，运营维护平台设置。"},
 {title:"现场反馈",desc:"收集线索清晰度与操作问题，安排改进。"}
];
export const riskControls: RiskControl[] = [
 {risk:"定位与权限",solution:"正式使用前在 HTTPS 环境用真实手机验收定位；围栏效果受现场和设备条件影响。"},
 {risk:"奖励履约",solution:"提前明确奖励内容、使用条件、有效期与库存，由门店办理确认和核销。"},
 {risk:"探索安全",solution:"选取公开营业且安全可达的区域，避免危险或禁止进入的点位。"},
 {risk:"内容质量",solution:"通过内容审核与玩家反馈持续改进线索，不把自动内容检测写成已接入能力。"}
];
