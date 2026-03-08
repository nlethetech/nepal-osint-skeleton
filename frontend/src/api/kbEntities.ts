/**
 * KB Entities API — Stub for open-source skeleton
 */

export interface KBEntity {
  id: string;
  canonical_name: string;
  canonical_name_ne?: string;
  entity_type: string;
  total_mentions: number;
}

export async function searchKBEntities(
  _query: string,
  _entityType?: string,
  _limit?: number,
): Promise<KBEntity[]> {
  return [];
}
