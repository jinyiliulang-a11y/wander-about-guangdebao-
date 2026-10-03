const discountNumber = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });
/** Percent values such as 88.12 become 8.812折 without binary floating-point tails. */
export const discountLabel = (percent: number) => `${discountNumber.format(percent / 10)}折`;
