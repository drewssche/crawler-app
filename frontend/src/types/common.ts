export type IdEmail = {
  id: number;
  email: string;
};

export type PagedResponse<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
};

