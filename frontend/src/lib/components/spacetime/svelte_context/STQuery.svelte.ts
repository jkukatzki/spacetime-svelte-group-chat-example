import { onMount, onDestroy, untrack } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';
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
 * 
 * **Automatic Cleanup:**
 * - Uses Svelte's createSubscriber to automatically clean up when effects are destroyed
 * - No need to manually call .destroy() when reassigning or switching between instances
 * - Cleanup happens automatically when the containing effect re-runs or is destroyed
 * 
 * **Object Reference Preservation:**
 * - For tables WITH primary keys: Rows are mutated in-place (push/splice/replace) to preserve object references
 * - For tables WITHOUT primary keys: Rows are append-only (onInsert only), updates/deletes are not supported
 * - This ensures that object references remain stable, allowing for reliable === comparisons in Svelte templates
 */
export class STQuery<
  DbConnection extends DbConnectionImpl,
  RowType extends Record<string, any>,
  TableName extends ValidTableName<DbConnection> = ValidTableName<DbConnection>
> {
  #actualRows: RowType[] = $state([]);
  state: 'loading' | 'ready' = $state('loading');
  
  private tableName: string;
  private tablePropertyName: string | null = null;
  private whereClause?: Expr<keyof RowType & string>;
  private callbacks?: UseQueryCallbacks<RowType>;
  private subscription: any = undefined;
  private eventListeners: (() => void)[] = [];
  private subscribe: () => void;

  constructor(
    tableName: TableName & AssertRowTypeMatches<DbConnection, RowType, TableName>,
    whereClause?: Expr<keyof RowType & string>,
    callbacks?: UseQueryCallbacks<RowType>
  ) {
    this.tableName = tableName;
    this.whereClause = whereClause;
    this.callbacks = callbacks;
    
    // Set up automatic cleanup using createSubscriber
    this.subscribe = createSubscriber(() => {
      // This function is called when the first effect reads this.rows
      return () => {
        // This cleanup function is called when all effects are destroyed
        this.cleanup();
      };
    });

    const context = getSpacetimeContext();
    // Get SpacetimeDB client from context internally
    try {
      
      
      if (!context.connection || !context.connected) {
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
   * Reactive rows property that triggers automatic cleanup registration.
   * Accessing this property registers the current effect for cleanup.
   */
  get rows(): RowType[] {
    // Register this access with the subscriber
    this.subscribe();
    return this.#actualRows;
  }

  private set rows(newRows: RowType[]) {
    this.#actualRows = newRows;
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
    
    // Convert snake_case table name to camelCase property name
    this.tablePropertyName = snakeToCamel(this.tableName);
    
    return this.tablePropertyName;
  }

  private setupConnectionWatcher(context: SpacetimeDBContext) {
    // Use Svelte's $effect to watch for connection changes
    $effect(() => {
      if (context.connection && context.connected) {
        // Use untrack to prevent reactive updates in initialize from causing loops
        untrack(() => {
          this.initialize(context);
        });
      }
    });
  }

  private initialize(context: SpacetimeDBContext) {
    // Don't initialize if client isn't ready yet or not connected
    if (!context.connection || !context.connected) {
      console.log('ReactiveTable: Client not ready or not connected for table:', this.tableName);
      return;
    }

    // Set up connection state listeners
    const onConnect = () => {
      untrack(() => {
        this.rows = []; // Clear rows on reconnect
        this.setupSubscription(context);
      });
    };
    const onDisconnect = () => {
      untrack(() => {
        this.state = 'loading';
        this.rows = []; // Clear rows on disconnect
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
    // Note: updateRows will be called by onApplied callback when subscription is ready
  }

  private setupSubscription(context: SpacetimeDBContext) {
    // Don't set up subscription if client isn't ready or not connected
    if (!context.connection || !context.connected) {
      console.log('ReactiveTable: No client available or not connected for subscription setup:', this.tableName);
      return;
    }

    // Clean up previous subscription
    if (this.subscription) {
      this.subscription.unsubscribe();
    }

    // Use table name directly in SQL query (snake_case)
    const query = `SELECT * FROM ${this.tableName}` +
      (this.whereClause ? ` WHERE ${toQueryString(this.whereClause)}` : '');
    console.log('QUERY', query);
    if ('subscriptionBuilder' in context.connection && typeof context.connection.subscriptionBuilder === 'function') {
      this.subscription = context.connection
        .subscriptionBuilder()
        .onApplied(() => {
          // Subscription is ready - onInsert callbacks have fired for all existing rows
          this.state = 'ready';
        })
        .subscribe(query);
    }
  }

  private setupTableEventListeners(context: SpacetimeDBContext) {
    if (!context.connection || !context.connection.db) {
      console.log('STQuery: No client or db available for event listeners:', this.tableName);
      return;
    }

    const propertyName = this.getTableProperty(context);
    if (!propertyName) {
      console.error('STQuery: Could not find table property for:', this.tableName);
      return;
    }

    const table = context.connection.db[propertyName] as any;
    
    // Check if table has onUpdate method (tables with primary keys have this)
    const hasOnUpdate = table && 'onUpdate' in table && typeof table.onUpdate === 'function';
    const hasOnDelete = table && 'onDelete' in table && typeof table.onDelete === 'function';
    
    console.log(`STQuery: Table '${this.tableName}' - hasOnUpdate: ${hasOnUpdate}, hasOnDelete: ${hasOnDelete}`);
    
    if (table && 'onInsert' in table) {
      const onInsert = (ctx: any, row: RowType) => {
        // Filter by where clause if provided
        if (this.whereClause && !evaluate(this.whereClause, row)) {
          return;
        }
        
        console.log('STQuery: onInsert for table:', this.tableName, row);
        
        // Call user callback
        this.callbacks?.onInsert?.(row);
        
        // Add to array and reassign to trigger reactivity
        this.#actualRows = [...this.#actualRows, row];
      };

      const onDelete = (ctx: any, row: RowType) => {
        // Filter by where clause if provided
        if (this.whereClause && !evaluate(this.whereClause, row)) {
          return;
        }
        
        console.log('STQuery: onDelete for table:', this.tableName, row);
        
        // Call user callback
        this.callbacks?.onDelete?.(row);
        
        // For tables without primary keys, we can't reliably find and remove rows
        // Try to find by object equality and create new array to trigger reactivity
        const index = this.#actualRows.findIndex(r => r === row);
        if (index !== -1) {
          this.#actualRows = [
            ...this.#actualRows.slice(0, index),
            ...this.#actualRows.slice(index + 1)
          ];
        } else {
          console.warn('STQuery: Could not find row to delete in table:', this.tableName);
        }
      };

      const onUpdate = (ctx: any, oldRow: RowType, newRow: RowType) => {
        console.log('STQuery: onUpdate triggered for table:', this.tableName);
        console.log('  oldRow:', oldRow);
        console.log('  newRow:', newRow);
        console.log('  Same reference?', oldRow === newRow);
        console.log('  oldRow.name:', (oldRow as any).name);
        console.log('  newRow.name:', (newRow as any).name);
        
        // Determine membership changes based on where clause
        const change = classifyMembership(this.whereClause, oldRow, newRow);
        
        if (change === 'enter') {
          console.log('STQuery: Row entering query result set');
          this.callbacks?.onInsert?.(newRow);
          // Add the new row to the array
          this.#actualRows = [...this.#actualRows, newRow];
        } else if (change === 'leave') {
          console.log('STQuery: Row leaving query result set');
          this.callbacks?.onDelete?.(oldRow);
          // Remove the old row from the array
          const index = this.#actualRows.findIndex(r => r === oldRow);
          if (index !== -1) {
            this.#actualRows = [
              ...this.#actualRows.slice(0, index),
              ...this.#actualRows.slice(index + 1)
            ];
          }
        } else if (change === 'stayIn') {
          console.log('STQuery: Row staying in query result set, calling onUpdate callback');
          this.callbacks?.onUpdate?.(oldRow, newRow);
          
          // Find the row in our array by identity (primary key for user table)
          // We can't use object equality because SpacetimeDB may have given us different references
          console.log('STQuery: Searching for row to update in array of length:', this.#actualRows.length);
          
          // Try to find by identity first (works for User table)
          let index = -1;
          if ('identity' in oldRow) {
            const oldIdentity = (oldRow as any).identity;
            index = this.#actualRows.findIndex(r => {
              if ('identity' in r) {
                const rIdentity = (r as any).identity;
                // Use isEqual method if available (for Identity objects)
                if (rIdentity && typeof rIdentity.isEqual === 'function') {
                  return rIdentity.isEqual(oldIdentity);
                }
                // Fallback to reference equality
                return rIdentity === oldIdentity;
              }
              return false;
            });
          }
          
          // Fallback to object reference equality
          if (index === -1) {
            index = this.#actualRows.findIndex(r => r === oldRow);
          }
          
          console.log('STQuery: Found index:', index);
          if (index !== -1) {
            // Create a shallow clone of newRow to ensure Svelte detects the change
            // This creates a new object reference while preserving all properties
            const clonedRow = { ...newRow } as RowType;
            
            // Create a new array with the cloned row to trigger Svelte's reactivity
            this.#actualRows = [
              ...this.#actualRows.slice(0, index),
              clonedRow,
              ...this.#actualRows.slice(index + 1)
            ];
            console.log('STQuery: Updated row at index', index, 'with cloned object');
            console.log('STQuery: Array after update:', this.#actualRows);
          } else {
            console.warn('STQuery: Could not find oldRow in rows array for update');
          }
        }
        // 'stayOut' requires no action
      };

      table.onInsert(onInsert);
      
      // Register onDelete if the table supports it
      if (hasOnDelete) {
        console.log(`STQuery: Registering onDelete listener for table '${this.tableName}'`);
        table.onDelete(onDelete);
      }
      
      // Register onUpdate if the table supports it (only tables with primary keys)
      if (hasOnUpdate) {
        console.log(`STQuery: Registering onUpdate listener for table '${this.tableName}'`);
        table.onUpdate(onUpdate);
      } else {
        console.log(`STQuery: Table '${this.tableName}' has no onUpdate method`);
      }

      // Store cleanup functions
      this.eventListeners.push(() => {
        if ('removeOnInsert' in table) {
          table.removeOnInsert(onInsert);
          if (hasOnDelete && 'removeOnDelete' in table) {
            table.removeOnDelete(onDelete);
          }
          if (hasOnUpdate && 'removeOnUpdate' in table) {
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
      const allRows = table.iter() as RowType[];
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
   * This is called automatically when effects are destroyed.
   * Can also be called manually when you no longer need the reactive table.
   */
  cleanup() {
    console.log('ReactiveTable: Cleaning up table:', this.tableName);
    
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }
    
    // Clean up all event listeners
    this.eventListeners.forEach(cleanupFn => cleanupFn());
    this.eventListeners = [];
    
    // Reset state
    this.state = 'loading';
    this.rows = [];
  }

  /**
   * Legacy destroy method for backward compatibility.
   * Calls cleanup() internally.
   */
  destroy() {
    this.cleanup();
  }

  /**
   * Update the where clause and refilter the data.
   * This allows dynamic filtering of the reactive table.
   */
  setWhereClause(context: SpacetimeDBContext, whereClause?: Expr<keyof RowType & string>) {
    this.whereClause = whereClause;
    this.setupSubscription(context);
    this.updateRows(context);
  }
}

type MembershipChange = 'enter' | 'leave' | 'stayIn' | 'stayOut';

/**
 * Extracts the column names from a RowType whose values are of type Value.
 * Note that this will exclude columns that are of type object, array, etc.
 */
type ColumnsFromRow<R> = {
  [K in keyof R]-?: R[K] extends Value | undefined ? K : never;
}[keyof R] &
  string;

/**
 * Helper type to extract the row type from a table handle.
 * Table handles have a tableCache property with type TableCache<RowType>.
 */
type ExtractRowType<T> = T extends { tableCache: { iter(): Iterable<infer R> } }
  ? R
  : never;

/**
 * Helper type to convert camelCase to snake_case at the type level.
 */
type CamelToSnake<S extends string> = S extends `${infer First}${infer Rest}`
  ? First extends Uppercase<First>
    ? `_${Lowercase<First>}${CamelToSnake<Rest>}`
    : `${First}${CamelToSnake<Rest>}`
  : S;

/**
 * Union of all valid table names (camelCase from db properties OR snake_case SQL names).
 */
type ValidTableName<DbConnection extends DbConnectionImpl> = 
  | keyof DbConnection['db'] & string
  | CamelToSnake<keyof DbConnection['db'] & string>;

/**
 * Find the db property key that corresponds to the given table name (handles both camelCase and snake_case).
 */
type TableNameToDbKey<
  DbConnection extends DbConnectionImpl,
  TableName extends string
> = TableName extends keyof DbConnection['db']
  ? TableName
  : {
      [K in keyof DbConnection['db']]: CamelToSnake<K & string> extends TableName ? K : never
    }[keyof DbConnection['db']];

/**
 * Assert that RowType matches the actual table row type.
 * This creates a compile-time check that will fail if the types don't match.
 */
type AssertRowTypeMatches<
  DbConnection extends DbConnectionImpl,
  RowType,
  TableName extends ValidTableName<DbConnection>
> = [RowType] extends [ExtractRowType<DbConnection['db'][TableNameToDbKey<DbConnection, TableName & string>]>]
  ? unknown
  : { error: 'RowType does not match table row type'; expected: ExtractRowType<DbConnection['db'][TableNameToDbKey<DbConnection, TableName & string>]>; got: RowType };

/**
 * Type alias for backward compatibility.
 * Use STQuery class directly instead.
 * @deprecated Use STQuery class instead
 */
export type ReactiveTable<T extends Record<string, any>> = STQuery<any, T>;

/**
 * Legacy factory function for backward compatibility.
 * @deprecated Use new STQuery<DbConnection, RowType>('table_name', ...) instead
 */
export function createReactiveTable<
  DbConnection extends DbConnectionImpl,
  RowType extends Record<string, any>,
  TableName extends ValidTableName<DbConnection> = ValidTableName<DbConnection>,
>(
  tableName: TableName,
  where: Expr<ColumnsFromRow<RowType>> & AssertRowTypeMatches<DbConnection, RowType, TableName>,
  callbacks?: UseQueryCallbacks<RowType>
): STQuery<DbConnection, RowType>;

export function createReactiveTable<
  DbConnection extends DbConnectionImpl,
  RowType extends Record<string, any>,
  TableName extends ValidTableName<DbConnection> = ValidTableName<DbConnection>,
>(
  tableName: TableName & AssertRowTypeMatches<DbConnection, RowType, TableName>,
  callbacks?: UseQueryCallbacks<RowType>
): STQuery<DbConnection, RowType>;

export function createReactiveTable<
  DbConnection extends DbConnectionImpl,
  RowType extends Record<string, any>,
>(
  tableName: string,
  whereClauseOrCallbacks?: Expr<ColumnsFromRow<RowType>> | UseQueryCallbacks<RowType>,
  callbacks?: UseQueryCallbacks<RowType>
): STQuery<DbConnection, RowType> {
  let whereClause: Expr<ColumnsFromRow<RowType>> | undefined;
  let actualCallbacks: UseQueryCallbacks<RowType> | undefined;
  
  // Handle different parameter combinations
  if (whereClauseOrCallbacks) {
    if (typeof whereClauseOrCallbacks === 'object' && 'type' in whereClauseOrCallbacks) {
      // First param is where clause
      whereClause = whereClauseOrCallbacks as Expr<ColumnsFromRow<RowType>>;
      actualCallbacks = callbacks;
    } else {
      // First param is callbacks
      actualCallbacks = whereClauseOrCallbacks as UseQueryCallbacks<RowType>;
    }
  }

  return new STQuery<DbConnection, RowType>(tableName as any, whereClause as any, actualCallbacks);
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
