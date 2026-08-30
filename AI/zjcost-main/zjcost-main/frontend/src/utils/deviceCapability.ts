/**
 * 设备图形能力判定：核显 / 低核数 / 低内存设备返回 true。
 * 用于重渲染场景（3D 漫游、粒子背景）自动降级画质，独显设备返回 false。
 */
export function isWeakGpuDevice(): boolean {
  try {
    const nav = navigator as Navigator & { deviceMemory?: number };
    if ((nav.hardwareConcurrency ?? 8) <= 4) return true;
    if ((nav.deviceMemory ?? 8) <= 4) return true;
    const gl = document.createElement("canvas").getContext("webgl");
    if (!gl) return true;
    const dbg = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : "";
    // 常见核显命名（独显一般是 NVIDIA GeForce / AMD Radeon RX 等带型号命名，不会命中）
    return /Intel|Iris|Mali|Adreno|Apple GPU|Radeon\(TM\)/i.test(renderer);
  } catch {
    return true;
  }
}
