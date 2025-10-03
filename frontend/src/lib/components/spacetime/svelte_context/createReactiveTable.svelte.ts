import { onMount, onDestroy, untrack } from 'svelte';
import { getSpacetimeContext, SpacetimeDBContext } from '../SpacetimeContext.svelte';
import type { DbConnectionImpl } from 'spacetimedb';
import { evaluate, toQueryString, type Expr, type Value } from './QueryFormatting';

// Re-export query building utilities from React implementation
export interface UseQueryCallbacks<RowType> {
  onInsert?: (row: RowType) => void;
  onDelete?: (row: RowType) => void;
  onUpdate?: (oldRow: RowType, newRow: RowType) => void;
}

/**
 * Convert snake_case table name to camelCase property name.
 * Examples:
 *   "user" -> "user"
 *   "groupchat_membership" -> "groupchatMembership"
 *   "group_chat_membership" -> "groupChatMembership"
 */
function snakeToCamel(tableName: string): string {
  return tableName.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}



/**
 * Reactive table class for Svelte 5 that provides real-time updates from SpacetimeDB.
 * This class encapsulates table subscription logic and maintains reactive state using $state().
 */
export class ReactiveTable<T> {
  rows: T[] | undefined = $state();
  state: 'loading' | 'ready' = $state('loading');
  
  private tableName: string;
  private tablePropertyName: string | null = null;
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

  /**
   * Get the property name to access the table on the db object.
   * This is cached after the first lookup.
   */
  private getTableProperty(context: SpacetimeDBContext): string | null {
    if (this.tablePropertyName) {
      return this.tablePropertyName;
    }
    
    if (!context.connection?.db) {
      return null;
    }
    
    // Convert snake_case to camelCase
    this.tablePropertyName = snakeToCamel(this.tableName);
    
    return this.tablePropertyName;
  }

  private setupConnectionWatcher(context: SpacetimeDBContext) {
    // Use Svelte's $effect to watch for connection changes
    $effect(() => {
      if (context.connection) {
        // Use untrack to prevent reactive updates in initialize from causing loops
        untrack(() => {
          this.initialize(context);
        });
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
      untrack(() => {
        this.setupSubscription(context);
      });
    };
    const onDisconnect = () => {
      untrack(() => {
        this.state = 'loading';
      });
    };
    const onConnectError = () => {
      untrack(() => {
        this.state = 'loading';
      });
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
    console.log('QUERY', query);
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

    const propertyName = this.getTableProperty(context);
    if (!propertyName) {
      console.error('ReactiveTable: Could not find table property for:', this.tableName);
      return;
    }

    const table = context.connection.db[propertyName] as any;
    
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

    const propertyName = this.getTableProperty(context);
    if (!propertyName) {
      console.error('ReactiveTable: Could not find table property for:', this.tableName);
      this.rows = [];
      return;
    }

    const table = context.connection.db[propertyName] as any;
    if (table && 'iter' in table) {
      const allRows = table.iter() as T[];
      this.rows = this.whereClause
        ? allRows.filter(row => evaluate(this.whereClause!, row))
        : allRows;
    } else {
      // Table exists but has no data or iter method - set to empty array
      this.rows = [];
    }
    
    // Set state to ready after successfully updating rows
    untrack(() => {
      this.state = 'ready';
      console.log('ReactiveTable: State set to ready for table:', this.tableName);
    });
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
