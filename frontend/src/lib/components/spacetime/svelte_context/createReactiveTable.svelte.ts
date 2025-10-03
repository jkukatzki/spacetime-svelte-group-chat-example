import { onMount, onDestroy, untrack } from 'svelte';
import { getSpacetimeContext, SpacetimeDBContext } from '../SpacetimeContext.svelte';
import type { DbConnectionImpl } from 'spacetimedb';
import { evaluate, toQueryString, type Expr, type Value } from './QueryFormatting';

// Helper type to extract RemoteTables from DbConnection
// DbConnection has a 'db' property that is of type RemoteTables
type ExtractRemoteTables<TDbConnection> = 
  TDbConnection extends { db: infer TTables } ? TTables : never;

// Helper type to extract the row type from a table handle
// TableHandles have an 'iter()' method that returns Iterable<RowType>
type ExtractRowType<T> = T extends { iter(): Iterable<infer R> } ? R : never;

// Extract table names from RemoteTables
type ExtractTableNames<TRemoteTables> = keyof TRemoteTables;

// Map each table name to its row type
type ExtractTableMap<TRemoteTables> = {
  [K in keyof TRemoteTables]: ExtractRowType<TRemoteTables[K]>
};

// Filter out table names that don't have valid types
type ExtractValidTableNames<TRemoteTables> = {
  [K in keyof TRemoteTables]: unknown extends ExtractRowType<TRemoteTables[K]> ? never : K
}[keyof TRemoteTables];

// Reverse lookup: Find table name from row type
// This maps each RowType back to its table name(s)
type FindTableNameForRowType<TRemoteTables, TRowType> = {
  [K in keyof TRemoteTables]: ExtractRowType<TRemoteTables[K]> extends TRowType 
    ? TRowType extends ExtractRowType<TRemoteTables[K]>
      ? K
      : never
    : never
}[keyof TRemoteTables];

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
  
  private tableName: string | null = null;
  private rowTypeHelper?: RowTypeHelper<T>;
  private tablePropertyName: string | null = null;
  private whereClause?: Expr<keyof T & string>;
  private callbacks?: UseQueryCallbacks<T>;
  private subscription: any = undefined;
  private eventListeners: (() => void)[] = [];

  constructor(
    tableNameOrHelper: string | RowTypeHelper<T>,
    whereClause?: Expr<keyof T & string>,
    callbacks?: UseQueryCallbacks<T>
  ) {
    // Determine if we received a table name or row type helper
    if (typeof tableNameOrHelper === 'string') {
      this.tableName = tableNameOrHelper;
    } else {
      this.rowTypeHelper = tableNameOrHelper;
    }
    
    this.whereClause = whereClause;
    this.callbacks = callbacks;
    const context = getSpacetimeContext();
    // Get SpacetimeDB client from context internally
    try {
      
      
      if (!context.connection) {
        console.log('ReactiveTable: Connection not available yet for table:', this.tableName || '(from row type)');
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
   * Resolve the table name from the row type helper by comparing AlgebraicTypes
   */
  private resolveTableName(context: SpacetimeDBContext): string | null {
    if (this.tableName) {
      return this.tableName;
    }
    
    if (!this.rowTypeHelper) {
      return null;
    }
    
    const conn = context.connection as any;
    if (!conn) {
      return null;
    }
    
    // Get the AlgebraicType from the row type helper
    const targetAlgebraicType = this.rowTypeHelper.getTypeScriptAlgebraicType();
    const targetTypeStr = JSON.stringify(targetAlgebraicType);
    
    // Try to access REMOTE_MODULE metadata
    if (conn._remoteModule && conn._remoteModule.tables) {
      const tables = conn._remoteModule.tables;
      
      // Search for matching table
      for (const [key, tableInfo] of Object.entries(tables)) {
        const tableTypeStr = JSON.stringify((tableInfo as any).rowType);
        if (tableTypeStr === targetTypeStr) {
          this.tableName = (tableInfo as any).tableName;
          return this.tableName;
        }
      }
    }
    
    console.warn('ReactiveTable: Could not resolve table name from row type helper');
    return null;
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
    
    // Resolve table name if needed
    const tableName = this.resolveTableName(context);
    if (!tableName) {
      return null;
    }
    
    // Convert snake_case to camelCase
    this.tablePropertyName = snakeToCamel(tableName);
    
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
      console.log('ReactiveTable: No client available for subscription setup');
      return;
    }
    
    // Resolve table name
    const tableName = this.resolveTableName(context);
    if (!tableName) {
      console.error('ReactiveTable: Could not resolve table name for subscription');
      return;
    }

    // Clean up previous subscription
    if (this.subscription) {
      this.subscription.unsubscribe();
    }

    const query = `SELECT * FROM ${tableName}` +
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
      console.log('ReactiveTable: No client or db available for event listeners');
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
 * The row type is specified, and validation ensures it matches a valid table in your schema.
 * 
 * @example
 * ```svelte
 * <script>
 *   import { createReactiveTable, eq, where } from './createReactiveTable.svelte';
 *   import type { DbConnection } from '../module_bindings';
 *   import { Message, User } from '../module_bindings';
 *   
 *   // Provide the row type object as first argument
 *   const messageTable = createReactiveTable<DbConnection, Message>(Message, where(eq('groupchatId', 123)));
 *   
 *   // With callbacks
 *   const userTable = createReactiveTable<DbConnection, User>(User, {
 *     onInsert: (row) => console.log('New user:', row),
 *   });
 * </script>
 * ```
 */

// Helper interface for row type objects that have getTypeScriptAlgebraicType
interface RowTypeHelper<T> {
  getTypeScriptAlgebraicType(): any;
  serialize?: (writer: any, value: T) => void;
  deserialize?: (reader: any) => T;
}

// Type-safe overload: rowType helper only
export function createReactiveTable<
  TDbConnection extends DbConnectionImpl,
  TRowType
>(
  rowType: RowTypeHelper<TRowType>
): ReactiveTable<TRowType>;

// Type-safe overload: rowType + whereClause
export function createReactiveTable<
  TDbConnection extends DbConnectionImpl,
  TRowType
>(
  rowType: RowTypeHelper<TRowType>,
  whereClause: Expr<keyof TRowType & string>
): ReactiveTable<TRowType>;

// Type-safe overload: rowType + callbacks
export function createReactiveTable<
  TDbConnection extends DbConnectionImpl,
  TRowType
>(
  rowType: RowTypeHelper<TRowType>,
  callbacks: UseQueryCallbacks<TRowType>
): ReactiveTable<TRowType>;

// Type-safe overload: rowType + whereClause + callbacks
export function createReactiveTable<
  TDbConnection extends DbConnectionImpl,
  TRowType
>(
  rowType: RowTypeHelper<TRowType>,
  whereClause: Expr<keyof TRowType & string>,
  callbacks: UseQueryCallbacks<TRowType>
): ReactiveTable<TRowType>;

// Implementation
export function createReactiveTable<
  TDbConnection extends DbConnectionImpl,
  TRowType
>(
  rowType: RowTypeHelper<TRowType>,
  whereClauseOrCallbacks?: Expr<keyof TRowType & string> | UseQueryCallbacks<TRowType>,
  callbacks?: UseQueryCallbacks<TRowType>
): ReactiveTable<TRowType> {
  // Parse arguments
  let whereClause: Expr<keyof TRowType & string> | undefined;
  let actualCallbacks: UseQueryCallbacks<TRowType> | undefined;

  if (whereClauseOrCallbacks) {
    if (typeof whereClauseOrCallbacks === 'object' && 'type' in whereClauseOrCallbacks) {
      whereClause = whereClauseOrCallbacks as Expr<keyof TRowType & string>;
      actualCallbacks = callbacks;
    } else {
      actualCallbacks = whereClauseOrCallbacks as UseQueryCallbacks<TRowType>;
    }
  }

  // Pass the row type helper directly to ReactiveTable
  // It will resolve the table name using AlgebraicType comparison
  return new ReactiveTable<TRowType>(rowType, whereClause, actualCallbacks);
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
