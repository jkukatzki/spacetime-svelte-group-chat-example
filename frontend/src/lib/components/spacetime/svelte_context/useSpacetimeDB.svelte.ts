import { getContext, hasContext } from 'svelte';
import type { DbConnectionImpl } from 'spacetimedb';

export const SPACETIMEDB_CONTEXT_KEY = Symbol('spacetimedb');

export interface SpacetimeDBContext<DbConnection extends DbConnectionImpl = DbConnectionImpl> {
  getConnection: () => DbConnection | undefined;
  connected: {
    readonly current: boolean;
  };
  error: {
    readonly current: Error | undefined;
  };
}

/**
 * Svelte 5 hook to access the SpacetimeDB connection from context.
 * Must be used within a component tree wrapped by `SpacetimeDBProvider`.
 * 
 * Following the useThrelte pattern, this provides a comprehensive context
 * with connection state, error handling, and the connection instance.
 * 
 * @throws Error if used outside of a SpacetimeDBProvider
 * @returns The SpacetimeDB connection
 */
export function useSpacetimeDB<DbConnection extends DbConnectionImpl = DbConnectionImpl>(): DbConnection {
  if (!hasContext(SPACETIMEDB_CONTEXT_KEY)) {
    throw new Error(
      'useSpacetimeDB must be used within a SpacetimeDBProvider component. Did you forget to add a `SpacetimeDBProvider` to your component tree?'
    );
  }
  
  const context = getContext<SpacetimeDBContext<DbConnection>>(SPACETIMEDB_CONTEXT_KEY);
  const connection = context.getConnection();
  
  if (!connection) {
    throw new Error(
      'SpacetimeDB connection not available. The connection may still be initializing.'
    );
  }
  
  return connection;
}

/**
 * Get the full SpacetimeDB context including connection state and errors.
 * Similar to how useThrelte provides the full ThrelteContext.
 * 
 * @returns The complete SpacetimeDB context
 */
export function useSpacetimeDBContext<DbConnection extends DbConnectionImpl = DbConnectionImpl>(): SpacetimeDBContext<DbConnection> {
  if (!hasContext(SPACETIMEDB_CONTEXT_KEY)) {
    throw new Error(
      'useSpacetimeDBContext must be used within a SpacetimeDBProvider component. Did you forget to add a `SpacetimeDBProvider` to your component tree?'
    );
  }
  
  return getContext<SpacetimeDBContext<DbConnection>>(SPACETIMEDB_CONTEXT_KEY);
}
