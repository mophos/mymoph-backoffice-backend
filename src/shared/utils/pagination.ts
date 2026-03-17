export interface PaginationInput {
  page: number;
  pageSize: number;
  offset: number;
}

export const parsePagination = (query: Record<string, unknown>): PaginationInput => {
  const rawPage = Number(query.page ?? 1);
  const rawPageSize = Number(query.pageSize ?? 20);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : 1;
  const pageSize = Number.isFinite(rawPageSize) ? Math.min(Math.max(Math.floor(rawPageSize), 1), 100) : 20;

  return {
    page,
    pageSize,
    offset: (page - 1) * pageSize
  };
};
