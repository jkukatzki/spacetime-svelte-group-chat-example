import { untrack } from 'svelte';
import { createSubscriber } from 'svelte/reactivity';
import { getSpacetimeContext, SpacetimeDBContext } from './SpacetimeContext.svelte';
import type { DbConnectionImpl, Identity, SubscriptionBuilderImpl } from 'spacetimedb';
import { evaluate, toQueryString, resolvePendingExpression, type Expr, type Value } from './QueryFormatting';

// Re-export query building utilities from React implementation
export interface UseQueryCallbacks<RowType> {
  onInsert?: (row: RowType) => void;
  onDelete?: (row: RowType) => void;
  onUpdate?: (oldRow: RowType, newRow: RowType) => void;
}

/**
 * Convert camelCase to snake_case.
 * Examples:
 *   "user" -> "user"
 *   "groupchatMembership" -> "groupchat_membership"
 */
function camelToSnake(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Convert snake_case to camelCase.
 * Examples:
 *   "user" -> "user"
 *   "groupchat_membership" -> "groupchatMembership"
 */
function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Map of valid table names to their row types
 */
type TableNameToRowType<DbConnection extends DbConnectionImpl> = {
  [K in keyof DbConnection['db']]: ExtractRowType<DbConnection['db'][K]>
} & {
  [K in keyof DbConnection['db'] as CamelToSnake<K & string>]: ExtractRowType<DbConnection['db'][K]>
};

/**
 * Get valid table names for a given row type
 */
type ValidTableNamesForRowType<
  DbConnection extends DbConnectionImpl,
  RowType
> = {
  [TableName in keyof TableNameToRowType<DbConnection>]: 
    RowType extends TableNameToRowType<DbConnection>[TableName] ? TableName : never
}[keyof TableNameToRowType<DbConnection>];


export type SubscriptionHandleImpl<
  DBView = any,
  Reducers = any,
  SetReducerFlags = any,
> = {
  unsubscribe: () => void;
}

/**
 * Reactive table class for Svelte 5 that provides real-time updates from SpacetimeDB.
 * 
 * **Features:**
 * - Automatic cleanup using Svelte's createSubscriber
 * - Reactive state with $state() runes
 * - Supports filtered queries with WHERE clauses
 * - Handles onInsert, onDelete, and onUpdate callbacks
 * - Creates new object references to trigger Svelte's fine-grained reactivity
 * 
 * **Event Subscription Management:**
 * Use the `.events` property to maintain subscriptions for event callbacks without
 * needing to access `.rows`. The `.events` object has methods to register callbacks
 * and reading any property on it keeps the subscription alive.
 * 
 * @example
 * ```ts
 * let pushMessages = $derived(new STQuery<DbConnection, Message>('message',
 *   where(eq('userId', currentUser.id))
 * ));
 * 
 * $effect(() => {
 *   if (pushMessages.events) {
 *     pushMessages.events.onInsert((msg) => showNotification(msg));
 *   }
 * });
 * ```
 */
export class STQuery<
  DbConnection extends DbConnectionImpl,
  RowType extends Record<string, any>,
> {
  #actualRows: RowType[] = $state([]);
  state: 'loading' | 'ready' = $state('loading');
  
  private tableName: string;
  private tablePropertyName: string | null = null;
  private whereClause?: Expr<ColumnNameVariants<keyof RowType & string>>;
  private lastSubscribedQuery: string | undefined;
  private callbacks?: UseQueryCallbacks<RowType>;
  private subscription: SubscriptionHandleImpl<any, any, any> | undefined = undefined;
  private eventListeners: (() => void)[] = [];
  private hasSetupEventListeners = false; // Track if we've already set up event listeners
  private rowsToSkipFromCache = 0; // Number of onInsert events to skip (rows already loaded from cache)
  private subscribeRows: () => void;
  private subscribeEvents: () => void;
  
  // Event subscription management
  #eventCallbacks: UseQueryCallbacks<RowType> = {};
  #eventsKeepAlive = $state(0);
  
  /**
   * Events object for registering callbacks. Reading any property or calling any method
   * on this object will keep the subscription alive for event handling.
   */
  events = {
    onInsert: (callback: (row: RowType) => void) => {
      this.subscribeEvents(); // Register event subscription
      this.#eventsKeepAlive; // Keep subscription alive
      this.#eventCallbacks.onInsert = callback;
    },
    onDelete: (callback: (row: RowType) => void) => {
      this.subscribeEvents();
      this.#eventsKeepAlive;
      this.#eventCallbacks.onDelete = callback;
    },
    onUpdate: (callback: (oldRow: RowType, newRow: RowType) => void) => {
      this.subscribeEvents();
      this.#eventsKeepAlive;
      this.#eventCallbacks.onUpdate = callback;
    }
  };
  
  constructor(
    tableName: ValidTableNamesForRowType<DbConnection, RowType> & string,
    whereClause?: Expr<ColumnNameVariants<keyof RowType & string>>,
    context?: SpacetimeDBContext
  ) {
    this.tableName = tableName;
    this.whereClause = whereClause;
    
    // Set up automatic cleanup using createSubscriber for rows
    this.subscribeRows = createSubscriber(() => {
      return () => {
        this.cleanup();
      };
    });
    
    // Set up automatic cleanup using createSubscriber for events
    this.subscribeEvents = createSubscriber(() => {
      return () => {
        this.cleanup();
      };
    });    
    try {
      // Use provided context or get from Svelte context
      const ctx = context || getSpacetimeContext();
        $effect(() => {
            // Watch for connection changes, active state, and identity changes
            const connection = ctx.connection; // Track the connection object itself
            const isActive = ctx.connection.isActive;
            const currentIdentity = ctx.identity; // Explicitly track identity
            
            console.log(`📊 STQuery(${this.tableName}) effect - isActive: ${isActive}, identity: ${currentIdentity?.toHexString()}`);
            
            if (!isActive) {
              console.log(`⏸️ STQuery(${this.tableName}) - Not active, cleaning up`);
              if (this.subscription) {
                this.subscription.unsubscribe();
                this.subscription = undefined;
              }
              this.lastSubscribedQuery = undefined;
              this.state = 'loading';
              // Clean up event listeners when not active
              this.eventListeners.forEach(cleanupFn => cleanupFn());
              this.eventListeners = [];
              return;
            }
              
              // Build SQL query - convert camelCase table name to snake_case for SQL
              const sqlTableName = camelToSnake(this.tableName);
              
              const whereClause = this.whereClause;
              const resolvedWhereClause = whereClause
                ? resolvePendingExpression(whereClause, { clientIdentity: currentIdentity })
                : undefined;

              if (whereClause && !resolvedWhereClause) {
                if (this.subscription) {
                  this.subscription.unsubscribe();
                  this.subscription = undefined;
                }
                this.lastSubscribedQuery = undefined;
                this.state = 'loading';
                // Clean up event listeners when where clause can't be resolved
                this.eventListeners.forEach(cleanupFn => cleanupFn());
                this.eventListeners = [];
                return;
              }

              const query = `SELECT * FROM ${sqlTableName}` +
                (resolvedWhereClause ? ` WHERE ${toQueryString(resolvedWhereClause, currentIdentity)}` : '');
              
              console.log(`🔍 STQuery(${this.tableName}) query: ${query}, lastQuery: ${this.lastSubscribedQuery}`);
              
              if (this.subscription && this.lastSubscribedQuery === query) {
                console.log(`✅ STQuery(${this.tableName}) - Already subscribed to this query`);
                return;
              }

              if (this.subscription) {
                console.log(`🔄 STQuery(${this.tableName}) - Unsubscribing from old query`);
                this.subscription.unsubscribe();
                this.subscription = undefined;
              }
              
              // Clean up old event listeners before setting up new ones
              this.eventListeners.forEach(cleanupFn => cleanupFn());
              this.eventListeners = [];
              this.hasSetupEventListeners = false; // Reset flag when cleaning up
              
              // Clear rows when query changes - they'll be repopulated from cache
              this.#actualRows = [];

              // Set up event listeners BEFORE subscribing
              // This ensures they're ready but won't fire for cached data
              if (!this.hasSetupEventListeners) {
                this.setupTableEventListeners(ctx);
                this.hasSetupEventListeners = true;
              }

              if ('subscriptionBuilder' in ctx.connection && typeof ctx.connection.subscriptionBuilder === 'function') {
                this.subscription = ctx.connection
                  .subscriptionBuilder()
                  .onApplied(() => {
                    this.state = 'ready';
                    
                    // Clear rows before initializing from cache
                    // This handles cases where onApplied fires multiple times
                    this.#actualRows = [];
                    
                    // Initialize from cache after subscription is applied
                    const propertyName = this.getTableProperty(ctx);
                    if (propertyName && ctx.connection.db) {
                      const table = ctx.connection.db[propertyName] as any;
                      if (table) {
                        this.initializeFromCache(ctx, table);
                      }
                    }
                  })
                  .subscribe(query);
                this.lastSubscribedQuery = query;
              }
           
            
          }
        );
        return;
    } catch {
      throw new Error(
        'Could not find SpacetimeDB client! Did you forget to add a ' +
          'SpacetimeDBProvider? STQuery must be used in the Svelte component tree ' +
          'under a SpacetimeDBProvider component.'
      );
    }
  }

  /**
   * Reactive rows property that triggers automatic cleanup registration.
   * Accessing this property registers the current effect for cleanup.
   */
  get rows(): RowType[] {
    // Register this access with the subscriber
    this.subscribeRows();
    
    return this.#actualRows;
  }

  private set rows(newRows: RowType[]) {
    this.#actualRows = newRows;
  }

  /**
   * Simple property that can be read to keep the subscription alive.
   * Useful when you only want to use callbacks and don't care about the rows.
   * 
   * @example
   * ```ts
   * let pushMessages = $derived(new STQuery(..., { onInsert: handleInsert }));
   * // Read this to keep subscription alive:
   * $effect(() => { pushMessages?.active; });
   * ```
   */
  get active(): boolean {
    this.subscribeRows();
    return this.state === 'ready';
  }

  /**
   * Get the property name to access the table on the db object.
   * Converts snake_case to camelCase if needed, since db properties are camelCase.
   */
  private getTableProperty(context: SpacetimeDBContext): string | null {
    if (this.tablePropertyName) {
      return this.tablePropertyName;
    }
    
    if (!context.connection?.db) {
      return null;
    }
    
    // Convert snake_case to camelCase for db property access
    this.tablePropertyName = snakeToCamel(this.tableName);
    
    return this.tablePropertyName;
  }

  /**
   * Find a row in the array by comparing primary key fields or query tag.
   * Dynamically determines the primary key field from the table.
   */
  private findRowIndex(targetRow: RowType, pkField?: string): number {
    // If we have a primary key field name, use it
    if (pkField && pkField in targetRow) {
      const targetPkValue = (targetRow as any)[pkField];
      const index = this.#actualRows.findIndex(r => {
        if (pkField in r) {
          const rPkValue = (r as any)[pkField];
          // Use isEqual method if available (for Identity objects)
          if (rPkValue && typeof rPkValue.isEqual === 'function') {
            return rPkValue.isEqual(targetPkValue);
          }
          // Standard equality for primitive types
          return rPkValue === targetPkValue;
        }
        return false;
      });
      
      if (index !== -1) return index;
    }
    
    // For tables without primary keys, check if row is already tagged with this query
    const rowTag = (targetRow as any).__stQueryTag;
    if (rowTag && rowTag === this.lastSubscribedQuery) {
      // Row is already tagged with this query, it's a duplicate
      return 0; // Return any valid index to indicate it exists
    }
    
    return -1; // Not found
  }

  /**
   * Create a new array with an item removed at the specified index.
   */
  private removeAtIndex(index: number): RowType[] {
    return [
      ...this.#actualRows.slice(0, index),
      ...this.#actualRows.slice(index + 1)
    ];
  }

  /**
   * Initialize rows from the client cache.
   * This populates the STQuery with existing cached rows that match the WHERE clause.
   */
  private initializeFromCache(context: SpacetimeDBContext, table: any) {
    // Access the table cache's iter() method to get all cached rows
    if (!table.tableCache || typeof table.tableCache.iter !== 'function') {
      return;
    }
    
    try {
      const cachedRows: RowType[] = table.tableCache.iter();
      
      // Filter rows based on the WHERE clause
      const filteredRows = cachedRows.filter(row => {
        if (!this.whereClause) {
          return true; // No filter, include all rows
        }
        return evaluate(this.whereClause, row, context.identity);
      });
      
      // Tag each row with the current query so we can detect duplicates
      filteredRows.forEach(row => {
        (row as any).__stQueryTag = this.lastSubscribedQuery;
      });
      
      // Initialize the rows array with filtered cached rows
      this.#actualRows = filteredRows;
    } catch (error) {
      // Silently handle cache initialization errors
    }
  }


  private setupTableEventListeners(context: SpacetimeDBContext) {
    // Always clean up existing listeners first to prevent duplicates
    this.eventListeners.forEach(cleanupFn => cleanupFn());
    this.eventListeners = [];
    
    if (!context.connection?.db) {
      return;
    }

    const propertyName = this.getTableProperty(context);
    if (!propertyName) {
      return;
    }

    const table = context.connection.db[propertyName] as any;
    if (!table || !('onInsert' in table)) {
      return;
    }
    
    // Don't initialize from cache here - it will be done in onApplied callback
    // This prevents double-adding rows when the subscription is applied
    
    // Extract the primary key field name from the table's metadata
    const pkField: string | undefined = table.tableCache?.tableTypeInfo?.primaryKey;
    
    // Check if table supports onUpdate/onDelete (tables with primary keys)
    const hasOnUpdate = 'onUpdate' in table && typeof table.onUpdate === 'function';
    const hasOnDelete = 'onDelete' in table && typeof table.onDelete === 'function';
    
    const onInsert = (ctx: any, row: RowType) => {
      if (this.whereClause && !evaluate(this.whereClause, row, context.identity)) {
        return;
      }
      
      // Check if row already exists (happens when SpacetimeDB fires onInsert for cached rows)
      const existingIndex = this.findRowIndex(row, pkField);
      if (existingIndex !== -1) {
        return;
      }
      
      // Tag the row with the current query
      (row as any).__stQueryTag = this.lastSubscribedQuery;
      
      // Call both constructor callbacks and event callbacks
      this.callbacks?.onInsert?.(row);
      this.#eventCallbacks.onInsert?.(row);
      this.#actualRows = [...this.#actualRows, row];
    };

    const onDelete = (ctx: any, row: RowType) => {
      if (this.whereClause && !evaluate(this.whereClause, row, context.identity)) {
        return;
      }
      
      // Call both constructor callbacks and event callbacks
      this.callbacks?.onDelete?.(row);
      this.#eventCallbacks.onDelete?.(row);
      
      const index = this.findRowIndex(row, pkField);
      if (index !== -1) {
        this.#actualRows = this.removeAtIndex(index);
      }
    };

    const onUpdate = (ctx: any, oldRow: RowType, newRow: RowType) => {
      const change = classifyMembership(this.whereClause, oldRow, newRow, context.identity);
      
      if (change === 'enter') {
        this.callbacks?.onInsert?.(newRow);
        this.#eventCallbacks.onInsert?.(newRow);
        this.#actualRows = [...this.#actualRows, newRow];
      } else if (change === 'leave') {
        this.callbacks?.onDelete?.(oldRow);
        this.#eventCallbacks.onDelete?.(oldRow);
        const index = this.findRowIndex(oldRow, pkField);
        if (index !== -1) {
          this.#actualRows = this.removeAtIndex(index);
        }
      } else if (change === 'stayIn') {
        this.callbacks?.onUpdate?.(oldRow, newRow);
        this.#eventCallbacks.onUpdate?.(oldRow, newRow);
        
        const index = this.findRowIndex(oldRow, pkField);
        if (index !== -1) {
          // Mutate the existing object in place to preserve references
          const existingRow = this.#actualRows[index];
          Object.assign(existingRow, newRow);
          // Create a new array to trigger Svelte reactivity
          this.#actualRows = [...this.#actualRows];
        }
      }
    };

    // Register event listeners
    table.onInsert(onInsert);
    if (hasOnDelete) {
      table.onDelete(onDelete);
    }
    if (hasOnUpdate) {
      table.onUpdate(onUpdate);
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

  /**
   * Clean up subscriptions and event listeners.
   * Called automatically when effects are destroyed, or manually when needed.
   */
  cleanup() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }
    
    this.eventListeners.forEach(cleanupFn => cleanupFn());
    this.eventListeners = [];
    this.hasSetupEventListeners = false; // Reset flag so listeners can be set up again if needed
    
    this.state = 'loading';
    this.rows = [];
  }

  /**
   * @deprecated Use cleanup() instead
   */
  destroy() {
    this.cleanup();
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
 * Union type that accepts both camelCase and snake_case versions of column names.
 */
type ColumnNameVariants<T extends string> = T | CamelToSnake<T>;

/**
 * Compatibility function for the original getReactiveTable API.
 * This maintains backward compatibility while providing the same functionality.
 * For new code, consider using createReactiveTable which returns a ReactiveTable instance.
 */

function classifyMembership<
  Col extends string,
  RowType = any,
>(where: Expr<Col> | undefined, oldRow: RowType, newRow: RowType, clientIdentity?: Identity): MembershipChange {
  if (!where) {
    return 'stayIn';
  }

  let effectiveWhere: Expr<Col> = where;
  if (effectiveWhere.type === 'pending') {
    const resolved = resolvePendingExpression(effectiveWhere, { clientIdentity });
    if (!resolved) {
      return 'stayOut';
    }
    effectiveWhere = resolved;
  }

  const oldIn = evaluate(effectiveWhere, oldRow, clientIdentity);
  const newIn = evaluate(effectiveWhere, newRow, clientIdentity);

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
