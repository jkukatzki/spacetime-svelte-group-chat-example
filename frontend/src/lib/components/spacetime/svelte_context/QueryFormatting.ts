import { Identity } from 'spacetimedb';

export type Value = string | number | boolean | Identity;

export type Expr<Column extends string> =
  | { type: 'eq'; key: Column; value: Value }
  | { type: 'isClient'; key: Column }
  | { type: 'not'; child: Expr<Column> }
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

export const isClient = <Column extends string>(
  key: Column
): Expr<Column> => ({ type: 'isClient', key });

export const not = <Column extends string>(
  child: Expr<Column>
): Expr<Column> => ({ type: 'not', child });

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
  row: RowType,
  clientIdentity?: Identity
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
    case 'isClient': {
      // isClient expression checks if a column equals the client's identity
      // If clientIdentity is not available yet, return false (row will be filtered out)
      if (!clientIdentity) {
        return false;
      }
      
      const rowValue = getRowValue(expr.key);
      
      // Handle Identity comparison
      if (rowValue instanceof Identity) {
        return rowValue.isEqual(clientIdentity);
      }
      
      // Handle hex string comparison
      return rowValue === identityToQueryCompliantHexString(clientIdentity);
    }
    case 'not': {
      return !evaluate(expr.child, row, clientIdentity);
    }
    case 'and':
      return expr.children.every(child => evaluate(child, row, clientIdentity));
    case 'or':
      return expr.children.some(child => evaluate(child, row, clientIdentity));
  }
}

function formatValue(v: Value): string {
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

export function toQueryString<Column extends string>(expr: Expr<Column>, clientIdentity?: Identity): string {
  switch (expr.type) {
    case 'eq':
      return `${escapeIdent(expr.key)} = ${formatValue(expr.value)}`;
    case 'isClient': {
      // isClient expression generates SQL that checks if column equals the client's identity
      // If clientIdentity is not available, return a condition that filters out all rows
      if (!clientIdentity) {
        console.warn('[isClient toQueryString] No client identity available, generating FALSE condition');
        return 'FALSE';
      }
      return `${escapeIdent(expr.key)} = ${formatValue(clientIdentity)}`;
    }
    case 'not': {
      // Optimize NOT expressions for SpacetimeDB compatibility (no NOT operator)
      // Apply De Morgan's Laws to push NOT down to the leaf level
      
      if (expr.child.type === 'eq') {
        // NOT (x = y) becomes x != y
        return `${escapeIdent(expr.child.key)} != ${formatValue(expr.child.value)}`;
      }
      
      if (expr.child.type === 'isClient') {
        // NOT (isClient(x)) becomes x != clientIdentity
        if (!clientIdentity) {
          console.warn('[NOT isClient toQueryString] No client identity available, generating TRUE condition');
          return 'TRUE';
        }
        return `${escapeIdent(expr.child.key)} != ${formatValue(clientIdentity)}`;
      }
      
      if (expr.child.type === 'and') {
        // De Morgan's Law: NOT (A AND B) = (NOT A) OR (NOT B)
        const negatedChildren = expr.child.children.map(child => 
          toQueryString({ type: 'not', child } as Expr<Column>, clientIdentity)
        );
        return parenthesize(negatedChildren.join(' OR '));
      }
      
      if (expr.child.type === 'or') {
        // De Morgan's Law: NOT (A OR B) = (NOT A) AND (NOT B)
        const negatedChildren = expr.child.children.map(child => 
          toQueryString({ type: 'not', child } as Expr<Column>, clientIdentity)
        );
        return parenthesize(negatedChildren.join(' AND '));
      }
      
      if (expr.child.type === 'not') {
        // Double negation: NOT (NOT x) = x
        return toQueryString(expr.child.child, clientIdentity);
      }
      
      // Fallback (shouldn't reach here with proper optimizations)
      return `NOT (${toQueryString(expr.child, clientIdentity)})`;
    }
    case 'and':
      return parenthesize(expr.children.map(child => toQueryString(child, clientIdentity)).join(' AND '));
    case 'or':
      return parenthesize(expr.children.map(child => toQueryString(child, clientIdentity)).join(' OR '));
  }
}

export function where<Column extends string>(expr: Expr<Column>): Expr<Column> {
  return expr;
}

/**
 * Check if an expression contains an isClient expression.
 * This is used to determine if we need to watch for identity changes.
 */
export function containsIsClient<Column extends string>(expr: Expr<Column>): boolean {
  switch (expr.type) {
    case 'isClient':
      return true;
    case 'not':
      return containsIsClient(expr.child);
    case 'and':
    case 'or':
      return expr.children.some(child => containsIsClient(child));
    case 'eq':
      return false;
  }
}