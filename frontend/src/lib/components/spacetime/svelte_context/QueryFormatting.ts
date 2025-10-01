export type Value = string | number | boolean;

export type Expr<Column extends string> =
  | { type: 'eq'; key: Column; value: Value }
  | { type: 'and'; children: Expr<Column>[] }
  | { type: 'or'; children: Expr<Column>[] };

export const eq = <Column extends string>(
  key: Column,
  value: Value
): Expr<Column> => ({ type: 'eq', key, value });

export const and = <Column extends string>(
  ...children: Expr<Column>[]
): Expr<Column> => {
  const flat: Expr<Column>[] = [];
  for (const c of children) {
    if (!c) continue;
    if (c.type === 'and') flat.push(...c.children);
    else flat.push(c);
  }
  const pruned = flat.filter(Boolean);
  if (pruned.length === 0) return { type: 'and', children: [] };
  if (pruned.length === 1) return pruned[0];
  return { type: 'and', children: pruned };
};

export const or = <Column extends string>(
  ...children: Expr<Column>[]
): Expr<Column> => {
  const flat: Expr<Column>[] = [];
  for (const c of children) {
    if (!c) continue;
    if (c.type === 'or') flat.push(...c.children);
    else flat.push(c);
  }
  const pruned = flat.filter(Boolean);
  if (pruned.length === 0) return { type: 'or', children: [] };
  if (pruned.length === 1) return pruned[0];
  return { type: 'or', children: pruned };
};

export function evaluate<Column extends string, RowType = any>(
  expr: Expr<Column>,
  row: RowType
): boolean {
  const rowRecord = row as Record<Column, unknown>;
  switch (expr.type) {
    case 'eq':
      return rowRecord[expr.key] === expr.value;
    case 'and':
      return expr.children.every(child => evaluate(child, row));
    case 'or':
      return expr.children.some(child => evaluate(child, row));
  }
}

function formatValue(v: Value): string {
  switch (typeof v) {
    case 'string':
      return `'${v.replace(/'/g, "''")}'`;
    case 'number':
      return Number.isFinite(v) ? String(v) : `'${String(v)}'`;
    case 'boolean':
      return v ? 'TRUE' : 'FALSE';
  }
}

function escapeIdent(id: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) return id;
  return `"${id.replace(/"/g, '""')}"`;
}

function parenthesize(s: string): string {
  if (!s.includes(' AND ') && !s.includes(' OR ')) return s;
  return `(${s})`;
}

export function toString<Column extends string>(expr: Expr<Column>): string {
  switch (expr.type) {
    case 'eq':
      return `${escapeIdent(expr.key)} = ${formatValue(expr.value)}`;
    case 'and':
      return parenthesize(expr.children.map(toString).join(' AND '));
    case 'or':
      return parenthesize(expr.children.map(toString).join(' OR '));
  }
}

export function where<Column extends string>(expr: Expr<Column>): Expr<Column> {
  return expr;
}