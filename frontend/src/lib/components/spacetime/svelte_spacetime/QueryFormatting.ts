import { Identity } from 'spacetimedb';
import type { ClientIdentity } from './SpacetimeContext.svelte';

export type Value = string | number | boolean | Identity;

export interface PendingResolutionContext {
  clientIdentity?: Identity;
}

type PendingExpr<Column extends string> = {
  type: 'pending';
  reason: 'missing-value';
  key?: Column;
  resolve: (context: PendingResolutionContext) => Expr<Column> | undefined;
};

export type Expr<Column extends string> =
  | { type: 'eq'; key: Column; value: Value }
  | { type: 'not'; child: Expr<Column> }
  | { type: 'and'; children: Expr<Column>[] }
  | { type: 'or'; children: Expr<Column>[] }
  | PendingExpr<Column>;

// Helper function to convert Identity to hex string with 0x prefix
function identityToQueryCompliantHexString(identity: Identity): string {
  return '0x' + identity.toHexString();
}

type EqInput<ValueType> = undefined extends ValueType
  ? ClientIdentity extends Exclude<ValueType, undefined>
    ? ValueType
    : never
  : ValueType;

export const eq = <
  Column extends string,
  InputValue extends Value | ClientIdentity | undefined
>(
  key: Column,
  value: EqInput<InputValue>
): Expr<Column> => {
  if (value === undefined) {
    return {
      type: 'pending',
      reason: 'missing-value',
      key,
      resolve: ({ clientIdentity }) => {
        if (!clientIdentity) return undefined;
        return { type: 'eq', key, value: clientIdentity };
      }
    };
  }
  return { type: 'eq', key, value: value as Value };
};

export const not = <Column extends string>(
  child: Expr<Column>
): Expr<Column> => {
  if (child.type === 'pending') {
    return {
      type: 'pending',
      reason: child.reason,
      key: child.key,
      resolve: (context) => {
        const resolvedChild = resolvePendingExpression(child, context);
        if (!resolvedChild) {
          return undefined;
        }
        return { type: 'not', child: resolvedChild };
      }
    };
  }
  return { type: 'not', child };
};

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

export function resolvePendingExpression<Column extends string>(
  expr: Expr<Column>,
  context: PendingResolutionContext
): Expr<Column> | undefined {
  switch (expr.type) {
    case 'pending':
      return expr.resolve(context);
    case 'not': {
      const resolvedChild = resolvePendingExpression(expr.child, context);
      if (!resolvedChild) return undefined;
      return { type: 'not', child: resolvedChild };
    }
    case 'and': {
      const resolvedChildren: Expr<Column>[] = [];
      for (const child of expr.children) {
        const resolvedChild = resolvePendingExpression(child, context);
        if (!resolvedChild) return undefined;
        resolvedChildren.push(resolvedChild);
      }
      return and(...resolvedChildren);
    }
    case 'or': {
      const resolvedChildren: Expr<Column>[] = [];
      for (const child of expr.children) {
        const resolvedChild = resolvePendingExpression(child, context);
        if (!resolvedChild) return undefined;
        resolvedChildren.push(resolvedChild);
      }
      return or(...resolvedChildren);
    }
    default:
      return expr;
  }
}

export function evaluate<Column extends string, RowType = any>(
  expr: Expr<Column>,
  row: RowType,
  clientIdentity?: Identity
): boolean {
  const concreteExpr = resolvePendingExpression(expr, { clientIdentity });
  if (!concreteExpr) {
    return false;
  }

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
  
  switch (concreteExpr.type) {
    case 'eq': {
      const rowValue = getRowValue(concreteExpr.key);
      const exprValue = concreteExpr.value;
      
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
    case 'not': {
      return !evaluate(concreteExpr.child, row, clientIdentity);
    }
    case 'and':
      return concreteExpr.children.every(child => evaluate(child, row, clientIdentity));
    case 'or':
      return concreteExpr.children.some(child => evaluate(child, row, clientIdentity));
    case 'pending':
      // This should never happen since we resolve pending expressions at the start
      return false;
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
  const concreteExpr = resolvePendingExpression(expr, { clientIdentity });
  if (!concreteExpr) {
    throw new Error(
      'Cannot convert pending expression to SQL. Ensure required values are available before building the WHERE clause.'
    );
  }

  switch (concreteExpr.type) {
    case 'eq':
      return `${escapeIdent(concreteExpr.key)} = ${formatValue(concreteExpr.value)}`;
    case 'not': {
      // Optimize NOT expressions for SpacetimeDB compatibility (no NOT operator)
      // Apply De Morgan's Laws to push NOT down to the leaf level
      
      if (concreteExpr.child.type === 'eq') {
        // NOT (x = y) becomes x != y
        return `${escapeIdent(concreteExpr.child.key)} != ${formatValue(concreteExpr.child.value)}`;
      }
      
      if (concreteExpr.child.type === 'and') {
        // De Morgan's Law: NOT (A AND B) = (NOT A) OR (NOT B)
        const negatedChildren = concreteExpr.child.children.map(child => 
          toQueryString({ type: 'not', child } as Expr<Column>, clientIdentity)
        );
        return parenthesize(negatedChildren.join(' OR '));
      }
      
      if (concreteExpr.child.type === 'or') {
        // De Morgan's Law: NOT (A OR B) = (NOT A) AND (NOT B)
        const negatedChildren = concreteExpr.child.children.map(child => 
          toQueryString({ type: 'not', child } as Expr<Column>, clientIdentity)
        );
        return parenthesize(negatedChildren.join(' AND '));
      }
      
      if (concreteExpr.child.type === 'not') {
        // Double negation: NOT (NOT x) = x
        return toQueryString(concreteExpr.child.child, clientIdentity);
      }
      
      // Fallback (shouldn't reach here with proper optimizations)
      return `NOT (${toQueryString(concreteExpr.child, clientIdentity)})`;
    }
    case 'and':
      return parenthesize(concreteExpr.children.map(child => toQueryString(child, clientIdentity)).join(' AND '));
    case 'or':
      return parenthesize(concreteExpr.children.map(child => toQueryString(child, clientIdentity)).join(' OR '));
    case 'pending':
      // This should never happen since we resolve and throw at the start
      throw new Error('Unexpected pending expression in toQueryString');
  }
}

export function where<Column extends string>(expr: Expr<Column>): Expr<Column> {
  return expr;
}
