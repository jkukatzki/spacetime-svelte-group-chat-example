import { Identity } from 'spacetimedb';

export type Value = string | number | boolean | Identity | undefined;

export type Expr<Column extends string> =
  | { type: 'eq'; key: Column; value: Value }
  | { type: 'neq'; key: Column; value: Value }
  | { type: 'and'; children: Expr<Column>[] }
  | { type: 'or'; children: Expr<Column>[] };

// Helper function to convert Identity to hex string with 0x prefix
function identityToQueryCompliantHexString(identity: Identity): string {
  return '0x' + identity.toHexString();
}

export const eq = <Column extends string>(
  key: Column,
  value: Value
): Expr<Column> => ({ type: 'eq', key, value });

export const neq = <Column extends string>(
  key: Column,
  value: Value
): Expr<Column> => ({ type: 'neq', key, value });

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

// Convert camelCase to snake_case for database field names
function camelToSnakeCase(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

// Convert snake_case to camelCase for TypeScript field names
function snakeToCamelCase(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

export function evaluate<Column extends string, RowType = any>(
  expr: Expr<Column>,
  row: RowType
): boolean {
  const rowRecord = row as Record<string, unknown>;
  
  // Helper to get value from row, trying both the key as-is and converted to camelCase
  const getRowValue = (key: string) => {
    // Try the key as provided first
    if (key in rowRecord) {
      return rowRecord[key];
    }
    // If not found and key contains underscore, try camelCase version
    if (key.includes('_')) {
      const camelKey = snakeToCamelCase(key);
      if (camelKey in rowRecord) {
        return rowRecord[camelKey];
      }
    }
    return undefined;
  };
  
  switch (expr.type) {
    case 'eq': {
      const rowValue = getRowValue(expr.key);
      const exprValue = expr.value;
      
      // Handle Identity comparison
      if (rowValue instanceof Identity && exprValue instanceof Identity) {
        return rowValue.isEqual(exprValue);
      }
      if (rowValue instanceof Identity) {
        return identityToQueryCompliantHexString(rowValue) === exprValue;
      }
      if (exprValue instanceof Identity) {
        return rowValue === identityToQueryCompliantHexString(exprValue);
      }
      
      return rowValue === exprValue;
    }
    case 'neq': {
      const rowValue = getRowValue(expr.key);
      const exprValue = expr.value;
      
      // Handle Identity comparison
      if (rowValue instanceof Identity && exprValue instanceof Identity) {
        return !rowValue.isEqual(exprValue);
      }
      if (rowValue instanceof Identity) {
        return identityToQueryCompliantHexString(rowValue) !== exprValue;
      }
      if (exprValue instanceof Identity) {
        return rowValue !== identityToQueryCompliantHexString(exprValue);
      }
      
      return rowValue !== exprValue;
    }
    case 'and':
      return expr.children.every(child => evaluate(child, row));
    case 'or':
      return expr.children.some(child => evaluate(child, row));
  }
}

function formatValue(v: Value): string {
  if (v === undefined) {
    return 'NULL';
  }
  
  if (v instanceof Identity) {
    const hexString = identityToQueryCompliantHexString(v);
    return `'${hexString.replace(/'/g, "''")}'`;
  }
  
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
  // Convert camelCase to snake_case for database compatibility
  const snakeCaseId = camelToSnakeCase(id);
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(snakeCaseId)) return snakeCaseId;
  return `"${snakeCaseId.replace(/"/g, '""')}"`;
}

function parenthesize(s: string): string {
  if (!s.includes(' AND ') && !s.includes(' OR ')) return s;
  return `(${s})`;
}

export function toQueryString<Column extends string>(expr: Expr<Column>): string {
  switch (expr.type) {
    case 'eq':
      return `${escapeIdent(expr.key)} = ${formatValue(expr.value)}`;
    case 'neq':
      return `${escapeIdent(expr.key)} != ${formatValue(expr.value)}`;
    case 'and':
      return parenthesize(expr.children.map(toQueryString).join(' AND '));
    case 'or':
      return parenthesize(expr.children.map(toQueryString).join(' OR '));
  }
}

export function where<Column extends string>(expr: Expr<Column>): Expr<Column> {
  return expr;
}