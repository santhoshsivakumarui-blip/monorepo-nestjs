export interface SearchDocument { id: string; type: string; tenantId?: string; updatedAt: string; body: Record<string, unknown>; }
export interface SearchQuery { query: string; cursor?: string; limit?: number; filters?: Record<string, string>; }
