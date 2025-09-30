import { onMount, onDestroy } from 'svelte';
import { useSpacetimeDB } from './useSpacetimeDB.svelte.js';
import type { DbConnectionImpl } from 'spacetimedb';

// Re-export query building utilities from React implementation
export interface UseQueryCallbacks<RowType> {
  onInsert?: (row: RowType) => void;
  onDelete?: (row: RowType) => void;
  onUpdate?: (oldRow: RowType, newRow: RowType) => void;
}

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

type Snapshot<RowType> = {
  readonly rows: readonly RowType[];
  readonly state: 'loading' | 'ready';
};

type MembershipChange = 'enter' | 'leave' | 'stayIn' | 'stayOut';

function classifyMembership<
  Col extends string,
  RowType = any,
>(where: Expr<Col> | undefined, oldRow: RowType, newRow: RowType): MembershipChange {
  if (!where) {
    return 'stayIn';
  }

  const oldIn = evaluate(where, oldRow);
  const newIn = evaluate(where, newRow);

  if (oldIn && !newIn) {
    return 'leave';
  }
  if (!oldIn && newIn) {
    return 'enter';
  }
  if (oldIn && newIn) {
    return 'stayIn';
  }
  return 'stayOut';
}

type ColumnsFromRow<R> = {
  [K in keyof R]-?: R[K] extends Value | undefined ? K : never;
}[keyof R] &
  string;

/**
 * Svelte 5 hook to subscribe to a table in SpacetimeDB and receive live updates.
 * 
 * This returns a Svelte 5 reactive snapshot that updates automatically when the
 * table changes OR when the where clause parameters change reactively.
 * The hook must be used within a component wrapped by SpacetimeDBProvider.
 * 
 * You must explicitly specify the DbConnection and RowType generics for proper typing:
 * 
 * @example
 * ```svelte
 * <script>
 *   import { useTable, where, eq } from './useTable.js';
 *   import type { Entity } from '../module_bindings';
 *   
 *   let gameId = $state(123);
 *   
 *   // CORRECT - specify types explicitly for proper typing
 *   const snapshot = useTable<DbConnection, Entity>('entity', () => where(eq('gameId', gameId)), {
 *     onInsert: (row) => console.log('Inserted entity:', row), // row is properly typed as Entity
 *     onDelete: (row) => console.log('Deleted entity:', row),   // row is properly typed as Entity
 *     onUpdate: (oldRow, newRow) => console.log('Updated:', oldRow, newRow), // both properly typed as Entity
 *   });
 *   
 *   // Access reactive data
 *   $: console.log('Current entities:', snapshot.rows); // snapshot.rows is Entity[]
 * </script>
 * ```
 */
export function useTable<
  DbConnection extends DbConnectionImpl,
  RowType, // Remove the extends constraint to allow proper typing
  TableName extends keyof DbConnection['db'] & string = keyof DbConnection['db'] & string,
>(
  tableName: TableName,
  whereClause: (() => Expr<keyof RowType & string>) | Expr<keyof RowType & string>,
  callbacks?: UseQueryCallbacks<RowType>
): Snapshot<RowType>;

export function useTable<
  DbConnection extends DbConnectionImpl,
  RowType, // Remove the extends constraint to allow proper typing
  TableName extends keyof DbConnection['db'] & string = keyof DbConnection['db'] & string,
>(
  tableName: TableName,
  callbacks?: UseQueryCallbacks<RowType>
): Snapshot<RowType>;

export function useTable<
  DbConnection extends DbConnectionImpl,
  RowType, // Remove the extends constraint to allow proper typing
  TableName extends keyof DbConnection['db'] & string = keyof DbConnection['db'] & string,
>(
  tableName: TableName,
  whereClauseOrCallbacks?:
    | (() => Expr<keyof RowType & string>)
    | Expr<keyof RowType & string>
    | UseQueryCallbacks<RowType>,
  callbacks?: UseQueryCallbacks<RowType>
): Snapshot<RowType> {
  let whereClauseFunc: (() => Expr<keyof RowType & string>) | undefined;
  let staticWhereClause: Expr<keyof RowType & string> | undefined;
  
  if (whereClauseOrCallbacks) {
    if (typeof whereClauseOrCallbacks === 'function') {
      whereClauseFunc = whereClauseOrCallbacks as () => Expr<ColumnsFromRow<RowType>>;
    } else if (typeof whereClauseOrCallbacks === 'object' && 'type' in whereClauseOrCallbacks) {
      staticWhereClause = whereClauseOrCallbacks as Expr<ColumnsFromRow<RowType>>;
    } else {
      callbacks = whereClauseOrCallbacks as UseQueryCallbacks<RowType> | undefined;
    }
  }

  let client: DbConnection;
  try {
    client = useSpacetimeDB<DbConnection>();
  } catch {
    throw new Error(
      'Could not find SpacetimeDB client! Did you forget to add a ' +
        '`SpacetimeDBProvider`? `useTable` must be used in the Svelte component tree ' +
        'under a `SpacetimeDBProvider` component.'
    );
  }

  // Svelte 5 reactive state
  let subscribeApplied = $state(false);
  let isActive = $state(false);
  let latestTransactionEvent = $state<any>(null);

  // Reactive where clause - updates when reactive dependencies change
  const currentWhereClause = $derived(
    whereClauseFunc ? whereClauseFunc() : staticWhereClause
  );

  // Reactive query - updates when where clause changes
  const currentQuery = $derived(
    `SELECT * FROM ${tableName}` +
    (currentWhereClause ? ` WHERE ${toString(currentWhereClause)}` : '')
  );

  const computeSnapshot = (): Snapshot<RowType> => {
    const table = client.db[
      tableName as keyof typeof client.db
    ] as unknown as { iter(): RowType[] };
    const result: readonly RowType[] = currentWhereClause
      ? table.iter().filter(row => evaluate(currentWhereClause, row))
      : table.iter();
    return {
      rows: result,
      state: subscribeApplied ? 'ready' : 'loading',
    };
  };

  // Create reactive snapshot - updates when data or where clause changes
  let snapshot = $derived(computeSnapshot());

  onMount(() => {
    // Set up connection state listeners
    const onConnect = () => {
      isActive = (client as any).isActive || true;
    };
    const onDisconnect = () => {
      isActive = (client as any).isActive || false;
    };
    const onConnectError = () => {
      isActive = (client as any).isActive || false;
    };

    // Add event listeners if the client supports them
    const clientWithEvents = client as any;
    if (clientWithEvents.on && typeof clientWithEvents.on === 'function') {
      clientWithEvents.on('connect', onConnect);
      clientWithEvents.on('disconnect', onDisconnect);
      clientWithEvents.on('connectError', onConnectError);
    }

    // Set up subscription that reacts to query changes
    let currentSubscription: any = undefined;
    $effect(() => {
      // Clean up previous subscription
      if (currentSubscription) {
        currentSubscription.unsubscribe();
        subscribeApplied = false;
      }

      // Set up new subscription with current query
      if (isActive && 'subscriptionBuilder' in client && typeof client.subscriptionBuilder === 'function') {
        currentSubscription = (client as any)
          .subscriptionBuilder()
          .onApplied(() => {
            subscribeApplied = true;
          })
          .subscribe(currentQuery);
      }
    });

    // Set up table event listeners for real-time updates
    const table = client.db[tableName as keyof typeof client.db] as any;
    
    if (table && 'onInsert' in table) {
      const onInsert = (ctx: any, row: RowType) => {
        // Use current where clause for filtering
        const whereClause = currentWhereClause;
        if (whereClause && !evaluate(whereClause, row)) {
          return;
        }
        callbacks?.onInsert?.(row);
        if (ctx.event !== latestTransactionEvent || !latestTransactionEvent) {
          latestTransactionEvent = ctx.event;
          // Trigger reactivity by updating a reactive value
          latestTransactionEvent = ctx.event;
        }
      };

      const onDelete = (ctx: any, row: RowType) => {
        // Use current where clause for filtering
        const whereClause = currentWhereClause;
        if (whereClause && !evaluate(whereClause, row)) {
          return;
        }
        callbacks?.onDelete?.(row);
        if (ctx.event !== latestTransactionEvent || !latestTransactionEvent) {
          latestTransactionEvent = ctx.event;
        }
      };

      const onUpdate = (ctx: any, oldRow: RowType, newRow: RowType) => {
        // Use current where clause for filtering
        const whereClause = currentWhereClause;
        const change = classifyMembership(whereClause, oldRow, newRow);
        
        if (change === 'enter') {
          callbacks?.onInsert?.(newRow);
        } else if (change === 'leave') {
          callbacks?.onDelete?.(oldRow);
        } else if (change === 'stayIn') {
          callbacks?.onUpdate?.(oldRow, newRow);
        }
        // 'stayOut' requires no action

        if (change !== 'stayOut' && (ctx.event !== latestTransactionEvent || !latestTransactionEvent)) {
          latestTransactionEvent = ctx.event;
        }
      };

      table.onInsert(onInsert);
      table.onDelete(onDelete);
      if ('onUpdate' in table) {
        table.onUpdate(onUpdate);
      }

      // Clean up function
      return () => {
        if (currentSubscription) {
          currentSubscription.unsubscribe();
        }
        if ('removeOnInsert' in table) {
          table.removeOnInsert(onInsert);
          table.removeOnDelete(onDelete);
          if ('removeOnUpdate' in table) {
            table.removeOnUpdate(onUpdate);
          }
        }
        if (clientWithEvents.off && typeof clientWithEvents.off === 'function') {
          clientWithEvents.off('connect', onConnect);
          clientWithEvents.off('disconnect', onDisconnect);
          clientWithEvents.off('connectError', onConnectError);
        }
      };
    }

    // Initialize connection state
    isActive = (client as any).isActive || true;
  });

  return snapshot;
}
