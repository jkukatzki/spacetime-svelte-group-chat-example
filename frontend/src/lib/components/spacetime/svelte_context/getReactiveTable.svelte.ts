import { onMount, onDestroy } from 'svelte';
import { getSpacetimeContext } from '../SpacetimeContext.svelte';
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

/**
 * Reactive table class for Svelte 5 that provides real-time updates from SpacetimeDB.
 * This class encapsulates table subscription logic and maintains reactive state using $state().
 */
export class ReactiveTable<T> {
  rows: T[] | undefined = $state();
  state: 'loading' | 'ready' = $state('loading');
  
  private client: any;
  private tableName: string;
  private whereClause?: Expr<keyof T & string>;
  private callbacks?: UseQueryCallbacks<T>;
  private subscription: any = undefined;
  private eventListeners: (() => void)[] = [];
  private latestTransactionEvent: any = $state(null);

  constructor(
    tableName: string,
    whereClause?: Expr<keyof T & string>,
    callbacks?: UseQueryCallbacks<T>
  ) {
    this.tableName = tableName;
    this.whereClause = whereClause;
    this.callbacks = callbacks;

    // Get SpacetimeDB client
    try {
      this.client = getSpacetimeContext().connection!;
    } catch {
      throw new Error(
        'Could not find SpacetimeDB client! Did you forget to add a ' +
          'SpacetimeDBProvider? ReactiveTable must be used in the Svelte component tree ' +
          'under a SpacetimeDBProvider component.'
      );
    }

    this.initialize();
  }

  private initialize() {
    // Set up connection state listeners
    const onConnect = () => {
      this.setupSubscription();
    };
    const onDisconnect = () => {
      this.state = 'loading';
    };
    const onConnectError = () => {
      this.state = 'loading';
    };

    // Add event listeners if the client supports them
    const clientWithEvents = this.client as any;
    if (clientWithEvents.on && typeof clientWithEvents.on === 'function') {
      clientWithEvents.on('connect', onConnect);
      clientWithEvents.on('disconnect', onDisconnect);
      clientWithEvents.on('connectError', onConnectError);
      
      this.eventListeners.push(() => {
        clientWithEvents.off('connect', onConnect);
        clientWithEvents.off('disconnect', onDisconnect);
        clientWithEvents.off('connectError', onConnectError);
      });
    }

    // Initial setup
    this.setupSubscription();
    this.setupTableEventListeners();
    this.updateRows();
  }

  private setupSubscription() {
    // Clean up previous subscription
    if (this.subscription) {
      this.subscription.unsubscribe();
    }

    const query = `SELECT * FROM ${this.tableName}` +
      (this.whereClause ? ` WHERE ${toString(this.whereClause)}` : '');

    if ('subscriptionBuilder' in this.client && typeof this.client.subscriptionBuilder === 'function') {
      this.subscription = this.client
        .subscriptionBuilder()
        .onApplied(() => {
          this.state = 'ready';
          this.updateRows();
        })
        .subscribe(query);
    }
  }

  private setupTableEventListeners() {
    const table = this.client.db[this.tableName] as any;
    
    if (table && 'onInsert' in table) {
      const onInsert = (ctx: any, row: T) => {
        // Filter by where clause if provided
        if (this.whereClause && !evaluate(this.whereClause, row)) {
          return;
        }
        
        // Call user callback
        this.callbacks?.onInsert?.(row);
        
        // Update reactive state
        this.updateRows();
        this.latestTransactionEvent = ctx.event;
      };

      const onDelete = (ctx: any, row: T) => {
        // Filter by where clause if provided
        if (this.whereClause && !evaluate(this.whereClause, row)) {
          return;
        }
        
        // Call user callback
        this.callbacks?.onDelete?.(row);
        
        // Update reactive state
        this.updateRows();
        this.latestTransactionEvent = ctx.event;
      };

      const onUpdate = (ctx: any, oldRow: T, newRow: T) => {
        // Determine membership changes based on where clause
        const change = classifyMembership(this.whereClause, oldRow, newRow);
        
        if (change === 'enter') {
          this.callbacks?.onInsert?.(newRow);
        } else if (change === 'leave') {
          this.callbacks?.onDelete?.(oldRow);
        } else if (change === 'stayIn') {
          this.callbacks?.onUpdate?.(oldRow, newRow);
        }
        // 'stayOut' requires no action

        if (change !== 'stayOut') {
          this.updateRows();
          this.latestTransactionEvent = ctx.event;
        }
      };

      table.onInsert(onInsert);
      table.onDelete(onDelete);
      if ('onUpdate' in table) {
        table.onUpdate(onUpdate);
      }

      // Store cleanup functions
      this.eventListeners.push(() => {
        if ('removeOnInsert' in table) {
          table.removeOnInsert(onInsert);
          table.removeOnDelete(onDelete);
          if ('removeOnUpdate' in table) {
            table.removeOnUpdate(onUpdate);
          }
        }
      });
    }
  }

  private updateRows() {
    const table = this.client.db[this.tableName] as any;
    if (table && 'iter' in table) {
      const allRows = table.iter() as T[];
      this.rows = this.whereClause
        ? allRows.filter(row => evaluate(this.whereClause!, row))
        : allRows;
    }
  }

  /**
   * Clean up all subscriptions and event listeners.
   * Call this when the component is destroyed or when you no longer need the reactive table.
   */
  destroy() {
    if (this.subscription) {
      this.subscription.unsubscribe();
    }
    
    // Clean up all event listeners
    this.eventListeners.forEach(cleanup => cleanup());
    this.eventListeners = [];
  }

  /**
   * Update the where clause and refilter the data.
   * This allows dynamic filtering of the reactive table.
   */
  setWhereClause(whereClause?: Expr<keyof T & string>) {
    this.whereClause = whereClause;
    this.setupSubscription();
    this.updateRows();
  }
}

type MembershipChange = 'enter' | 'leave' | 'stayIn' | 'stayOut';

/**
 * Factory function to create a ReactiveTable instance.
 * This provides a convenient way to create reactive tables with proper TypeScript typing.
 * 
 * @example
 * ```svelte
 * <script>
 *   import { createReactiveTable, eq, where } from './getReactiveTable.js';
 *   import type { Message } from '../module_bindings';
 *   
 *   // Create reactive table with where clause
 *   const messageTable = createReactiveTable<Message>('message', where(eq('chatId', 123)), {
 *     onInsert: (row) => console.log('New message:', row),
 *     onUpdate: (oldRow, newRow) => console.log('Updated message:', oldRow, newRow),
 *     onDelete: (row) => console.log('Deleted message:', row)
 *   });
 *   
 *   // Access reactive data
 *   $: console.log('Messages:', messageTable.rows);
 *   $: console.log('State:', messageTable.state);
 * </script>
 * ```
 */
export function createReactiveTable<T>(
  tableName: string,
  whereClause: Expr<keyof T & string>,
  callbacks?: UseQueryCallbacks<T>
): ReactiveTable<T>;

export function createReactiveTable<T>(
  tableName: string,
  callbacks?: UseQueryCallbacks<T>
): ReactiveTable<T>;

export function createReactiveTable<T>(
  tableName: string,
  whereClauseOrCallbacks?: Expr<keyof T & string> | UseQueryCallbacks<T>,
  callbacks?: UseQueryCallbacks<T>
): ReactiveTable<T> {
  let whereClause: Expr<keyof T & string> | undefined;
  
  if (whereClauseOrCallbacks) {
    if (typeof whereClauseOrCallbacks === 'object' && 'type' in whereClauseOrCallbacks) {
      whereClause = whereClauseOrCallbacks as Expr<keyof T & string>;
    } else {
      callbacks = whereClauseOrCallbacks as UseQueryCallbacks<T>;
    }
  }

  return new ReactiveTable<T>(tableName, whereClause, callbacks);
}

/**
 * Compatibility function for the original getReactiveTable API.
 * This maintains backward compatibility while providing the same functionality.
 * For new code, consider using createReactiveTable which returns a ReactiveTable instance.
 */

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
 *   import { getReactiveTable, where, eq } from './getReactiveTable.js';
 *   import type { Entity } from '../module_bindings';
 *   
 *   let gameId = $state(123);
 *   
 *   // CORRECT - specify types explicitly for proper typing
 *   const snapshot = getReactiveTable<DbConnection, Entity>('entity', () => where(eq('gameId', gameId)), {
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
export function getReactiveTable<
  DbConnection extends DbConnectionImpl,
  RowType, // Remove the extends constraint to allow proper typing
  TableName extends keyof DbConnection['db'] & string = keyof DbConnection['db'] & string,
>(
  tableName: TableName,
  whereClause: (() => Expr<keyof RowType & string>) | Expr<keyof RowType & string>,
  callbacks?: UseQueryCallbacks<RowType>
): Snapshot<RowType>;

export function getReactiveTable<
  DbConnection extends DbConnectionImpl,
  RowType, // Remove the extends constraint to allow proper typing
  TableName extends keyof DbConnection['db'] & string = keyof DbConnection['db'] & string,
>(
  tableName: TableName,
  callbacks?: UseQueryCallbacks<RowType>
): Snapshot<RowType>;

export function getReactiveTable<
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
    client = getSpacetimeContext<DbConnection>().connection!;
  } catch {
    throw new Error(
      'Could not find SpacetimeDB client! Did you forget to add a ' +
        '`SpacetimeDBProvider`? `getReactiveTable` must be used in the Svelte component tree ' +
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
