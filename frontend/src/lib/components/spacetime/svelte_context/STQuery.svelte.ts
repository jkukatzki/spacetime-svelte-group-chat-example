import { untrack } from 'svelte';
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
 * 
 * **Features:**
 * - Automatic cleanup using Svelte's createSubscriber
 * - Reactive state with $state() runes
 * - Supports filtered queries with WHERE clauses
 * - Handles onInsert, onDelete, and onUpdate callbacks
 * - Creates new object references to trigger Svelte's fine-grained reactivity
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
    
    try {
      if (!context.connection || !context.connected) {
        // Set up a watcher for when connection becomes available
        this.setupConnectionWatcher(context);
        return;
      }
    } catch {
      throw new Error(
        'Could not find SpacetimeDB client! Did you forget to add a ' +
          'SpacetimeDBProvider? STQuery must be used in the Svelte component tree ' +
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
    $effect(() => {
      if (context.connection && context.connected) {
        untrack(() => {
          this.initialize(context);
        });
      }
    });
  }

  /**
   * Find a row in the array by comparing primary key fields or object reference.
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
    
    // Fallback to object reference equality
    return this.#actualRows.findIndex(r => r === targetRow);
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
   * Create a new array with an item replaced at the specified index.
   */
  private replaceAtIndex(index: number, newItem: RowType): RowType[] {
    return [
      ...this.#actualRows.slice(0, index),
      newItem,
      ...this.#actualRows.slice(index + 1)
    ];
  }

  private initialize(context: SpacetimeDBContext) {
    if (!context.connection || !context.connected) {
      return;
    }

    // Set up connection state listeners
    const onConnect = () => {
      untrack(() => {
        this.rows = [];
        this.setupSubscription(context);
      });
    };
    const onDisconnect = () => {
      untrack(() => {
        this.state = 'loading';
        this.rows = [];
      });
    };
    const onConnectError = () => {
      untrack(() => {
        this.state = 'loading';
      });
    };

    // Add event listeners if the client supports them
    const clientWithEvents = context.connection as any;
    if (clientWithEvents?.on && typeof clientWithEvents.on === 'function') {
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
  }

  private setupSubscription(context: SpacetimeDBContext) {
    if (!context.connection || !context.connected) {
      return;
    }

    // Clean up previous subscription
    if (this.subscription) {
      this.subscription.unsubscribe();
    }

    // Build SQL query
    const query = `SELECT * FROM ${this.tableName}` +
      (this.whereClause ? ` WHERE ${toQueryString(this.whereClause)}` : '');
    
    if ('subscriptionBuilder' in context.connection && typeof context.connection.subscriptionBuilder === 'function') {
      this.subscription = context.connection
        .subscriptionBuilder()
        .onApplied(() => {
          this.state = 'ready';
        })
        .subscribe(query);
    }
  }

  private setupTableEventListeners(context: SpacetimeDBContext) {
    if (!context.connection?.db) {
      return;
    }

    const propertyName = this.getTableProperty(context);
    if (!propertyName) {
      console.error('STQuery: Could not find table property for:', this.tableName);
      return;
    }

    const table = context.connection.db[propertyName] as any;
    if (!table || !('onInsert' in table)) {
      return;
    }
    
    // Extract the primary key field name from the table's metadata
    const pkField: string | undefined = table.tableCache?.tableTypeInfo?.primaryKey;
    
    // Check if table supports onUpdate/onDelete (tables with primary keys)
    const hasOnUpdate = 'onUpdate' in table && typeof table.onUpdate === 'function';
    const hasOnDelete = 'onDelete' in table && typeof table.onDelete === 'function';
    
    const onInsert = (ctx: any, row: RowType) => {
      if (this.whereClause && !evaluate(this.whereClause, row)) {
        return;
      }
      
      this.callbacks?.onInsert?.(row);
      this.#actualRows = [...this.#actualRows, row];
    };

    const onDelete = (ctx: any, row: RowType) => {
      if (this.whereClause && !evaluate(this.whereClause, row)) {
        return;
      }
      
      this.callbacks?.onDelete?.(row);
      
      const index = this.findRowIndex(row, pkField);
      if (index !== -1) {
        this.#actualRows = this.removeAtIndex(index);
      }
    };

    const onUpdate = (ctx: any, oldRow: RowType, newRow: RowType) => {
      const change = classifyMembership(this.whereClause, oldRow, newRow);
      
      if (change === 'enter') {
        this.callbacks?.onInsert?.(newRow);
        this.#actualRows = [...this.#actualRows, newRow];
      } else if (change === 'leave') {
        this.callbacks?.onDelete?.(oldRow);
        const index = this.findRowIndex(oldRow, pkField);
        if (index !== -1) {
          this.#actualRows = this.removeAtIndex(index);
        }
      } else if (change === 'stayIn') {
        this.callbacks?.onUpdate?.(oldRow, newRow);
        
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

  private updateRows(context: SpacetimeDBContext) {
    if (!context.connection?.db) {
      return;
    }

    const propertyName = this.getTableProperty(context);
    if (!propertyName) {
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
      this.rows = [];
    }
    
    untrack(() => {
      this.state = 'ready';
    });
  }

  /**
   * Clean up all subscriptions and event listeners.
   * Called automatically when effects are destroyed, or manually when needed.
   */
  cleanup() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = undefined;
    }
    
    this.eventListeners.forEach(cleanupFn => cleanupFn());
    this.eventListeners = [];
    
    this.state = 'loading';
    this.rows = [];
  }

  /**
   * @deprecated Use cleanup() instead
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
