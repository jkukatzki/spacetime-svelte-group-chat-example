import { onMount, onDestroy } from 'svelte';
import { getSpacetimeContext, SpacetimeDBContext } from '../SpacetimeContext.svelte';
import type { DbConnectionImpl } from 'spacetimedb';
import { evaluate, toString as toQueryString, type Expr, type Value } from './QueryFormatting';

// Re-export query building utilities from React implementation
export interface UseQueryCallbacks<RowType> {
  onInsert?: (row: RowType) => void;
  onDelete?: (row: RowType) => void;
  onUpdate?: (oldRow: RowType, newRow: RowType) => void;
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
  
  private tableName: string;
  private whereClause?: Expr<keyof T & string>;
  private callbacks?: UseQueryCallbacks<T>;
  private subscription: any = undefined;
  private eventListeners: (() => void)[] = [];

  constructor(
    tableName: string,
    whereClause?: Expr<keyof T & string>,
    callbacks?: UseQueryCallbacks<T>
  ) {
    this.tableName = tableName;
    this.whereClause = whereClause;
    this.callbacks = callbacks;
    const context = getSpacetimeContext();
    // Get SpacetimeDB client from context internally
    try {
      
      
      if (!context.connection) {
        console.log('ReactiveTable: Connection not available yet for table:', this.tableName);
        // Set up a watcher for when connection becomes available
        this.setupConnectionWatcher(context);
        return;
      }
    } catch {
      throw new Error(
        'Could not find SpacetimeDB client! Did you forget to add a ' +
          'SpacetimeDBProvider? ReactiveTable must be used in the Svelte component tree ' +
          'under a SpacetimeDBProvider component.'
      );
    }

    this.initialize(context);
  }

  private setupConnectionWatcher(context: SpacetimeDBContext) {
    // Use Svelte's $effect to watch for connection changes
    $effect(() => {
      if (context.connection) {
        this.initialize(context);
      }
    });
  }

  private initialize(context: SpacetimeDBContext) {
    // Don't initialize if client isn't ready yet
    if (!context.connection) {
      console.log('ReactiveTable: Client not ready for table:', this.tableName);
      return;
    }

    // Set up connection state listeners
    const onConnect = () => {
      this.setupSubscription(context);
    };
    const onDisconnect = () => {
      this.state = 'loading';
    };
    const onConnectError = () => {
      this.state = 'loading';
    };

    // Add event listeners if the client supports them
    const clientWithEvents = context.connection as any;
    if (clientWithEvents && clientWithEvents.on && typeof clientWithEvents.on === 'function') {
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
    this.setupSubscription(context);
    this.setupTableEventListeners(context);
    this.updateRows(context);
  }

  private setupSubscription(context: SpacetimeDBContext) {
    // Don't set up subscription if client isn't ready
    if (!context.connection) {
      console.log('ReactiveTable: No client available for subscription setup:', this.tableName);
      return;
    }

    // Clean up previous subscription
    if (this.subscription) {
      this.subscription.unsubscribe();
    }

    const query = `SELECT * FROM ${this.tableName}` +
      (this.whereClause ? ` WHERE ${toQueryString(this.whereClause)}` : '');

    if ('subscriptionBuilder' in context.connection && typeof context.connection.subscriptionBuilder === 'function') {
      this.subscription = context.connection
        .subscriptionBuilder()
        .onApplied(() => {
          this.state = 'ready';
          this.updateRows(context);
        })
        .subscribe(query);
    }
  }

  private setupTableEventListeners(context: SpacetimeDBContext) {
    if (!context.connection || !context.connection.db) {
      console.log('ReactiveTable: No client or db available for event listeners:', this.tableName);
      return;
    }

    const table = context.connection.db[this.tableName] as any;
    
    if (table && 'onInsert' in table) {
      const onInsert = (ctx: any, row: T) => {
        // Filter by where clause if provided
        if (this.whereClause && !evaluate(this.whereClause, row)) {
          return;
        }
        
        // Call user callback
        this.callbacks?.onInsert?.(row);
        
        // Update reactive state
        this.updateRows(context);
      };

      const onDelete = (ctx: any, row: T) => {
        // Filter by where clause if provided
        if (this.whereClause && !evaluate(this.whereClause, row)) {
          return;
        }
        
        // Call user callback
        this.callbacks?.onDelete?.(row);
        
        // Update reactive state
        this.updateRows(context);
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
          this.updateRows(context);
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

  private updateRows(context: SpacetimeDBContext) {
    if (!context.connection || !context.connection.db) {
      console.log('ReactiveTable: No client or db available for updating rows:', this.tableName);
      return;
    }

    const table = context.connection.db[this.tableName] as any;
    if (table && 'iter' in table) {
      const allRows = table.iter() as T[];
      this.rows = this.whereClause
        ? allRows.filter(row => evaluate(this.whereClause!, row))
        : allRows;
    } else {
      // Table exists but has no data or iter method - set to empty array
      this.rows = [];
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
  setWhereClause(context: SpacetimeDBContext, whereClause?: Expr<keyof T & string>) {
    this.whereClause = whereClause;
    this.setupSubscription(context);
    this.updateRows(context);
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
  whereClauseOrCallbacks?: Expr<keyof T & string> | UseQueryCallbacks<T>,
  callbacks?: UseQueryCallbacks<T>
): ReactiveTable<T> {
  let whereClause: Expr<keyof T & string> | undefined;
  let actualCallbacks: UseQueryCallbacks<T> | undefined;
  
  // Handle different parameter combinations
  if (whereClauseOrCallbacks) {
    if (typeof whereClauseOrCallbacks === 'object' && 'type' in whereClauseOrCallbacks) {
      // First param is where clause
      whereClause = whereClauseOrCallbacks as Expr<keyof T & string>;
      actualCallbacks = callbacks;
    } else {
      // First param is callbacks
      actualCallbacks = whereClauseOrCallbacks as UseQueryCallbacks<T>;
    }
  }

  return new ReactiveTable<T>(tableName, whereClause, actualCallbacks);
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
    (currentWhereClause ? ` WHERE ${toQueryString(currentWhereClause)}` : '')
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
