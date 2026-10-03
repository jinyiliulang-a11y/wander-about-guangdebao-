/** Shared picker values; arbitrary text is not a new store icon. */
export const STORE_ICONS = [
  { value: "🏪", label: "门店" },
  { value: "🍵", label: "茶饮" },
  { value: "📚", label: "书店" },
  { value: "🎨", label: "手作" },
  { value: "☕", label: "咖啡" },
  { value: "🍰", label: "甜品" },
  { value: "🍜", label: "餐饮" },
  { value: "🍔", label: "快餐" },
  { value: "🧋", label: "奶茶" },
  { value: "🛍️", label: "购物" },
  { value: "🎁", label: "礼品" },
  { value: "🌸", label: "花艺" },
  { value: "💐", label: "花店" },
  { value: "🧸", label: "玩具" },
  { value: "🎮", label: "游戏" },
  { value: "💎", label: "饰品" },
  { value: "🌿", label: "植物" },
  { value: "🍀", label: "生活" },
  { value: "⭐", label: "精选" },
  { value: "🧪", label: "实验" },
] as const;
export type StoreIcon = (typeof STORE_ICONS)[number]["value"];
const storeIconValues: ReadonlySet<string> = new Set(STORE_ICONS.map(icon => icon.value));
export const isStoreIcon = (value: unknown): value is StoreIcon => typeof value === "string" && storeIconValues.has(value);
