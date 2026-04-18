/**
 * @file chineseSizeMap.ts
 * @description 中文字号名 ↔ pt 值映射（与后端 src-python/thesis_worker/utils/size.py 同步）
 * @author Atlas.oi
 * @date 2026-04-18
 */

export const CHINESE_SIZE_MAP: Record<string, number> = {
  '初号': 42,
  '小初': 36,
  '一号': 26,
  '小一': 24,
  '二号': 22,
  '小二': 18,
  '三号': 16,
  '小三': 15,
  '四号': 14,
  '小四': 12,
  '五号': 10.5,
  '小五': 9,
  '六号': 7.5,
  '小六': 6.5,
};

/** 字号名 → pt 值；不存在返回 null */
export function nameToPt(name: string): number | null {
  return CHINESE_SIZE_MAP[name] ?? null;
}

/** pt 值 → 字号名；不存在返回 null */
export function ptToName(pt: number): string | null {
  for (const [name, value] of Object.entries(CHINESE_SIZE_MAP)) {
    if (value === pt) return name;
  }
  return null;
}
