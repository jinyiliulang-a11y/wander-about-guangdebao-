/** Public display names never replace the immutable registered device ID. */
export const deviceDisplayName = (deviceId: string) => deviceId === "coin-tea-01" ? "测试金币" : deviceId;
