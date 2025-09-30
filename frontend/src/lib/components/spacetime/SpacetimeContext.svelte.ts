import { getContext, hasContext, setContext } from 'svelte';
import type { DbConnectionImpl } from 'spacetimedb';

export const SPACETIMEDB_CONTEXT_KEY = Symbol('spacetimedb');

export class SpacetimeDBContext<DbConnection extends DbConnectionImpl = DbConnectionImpl> {
  connection: DbConnection | undefined = $state();
  error: Error | undefined = $state(undefined);
  connected: boolean = $state(false);

  constructor(connection?: DbConnection, error?: Error) {
    this.connection = connection;
    this.error = error;
  }
}


/**
 * Get the full SpacetimeDB context including connection state and errors.
 * Similar to how useThrelte provides the full ThrelteContext.
 * 
 * @returns The complete SpacetimeDB context
 */
export function getSpacetimeContext<DbConnection extends DbConnectionImpl = DbConnectionImpl>(): SpacetimeDBContext<DbConnection> {
  if (!hasContext(SPACETIMEDB_CONTEXT_KEY)) {
    throw new Error(
      'getSpacetimeContext must be used within a SpacetimeDBProvider component. Did you forget to add a `SpacetimeDBProvider` to your component tree?'
    );
  }
  
  return getContext<SpacetimeDBContext<DbConnection>>(SPACETIMEDB_CONTEXT_KEY);
}

export function setSpacetimeContext<DbConnection extends DbConnectionImpl = DbConnectionImpl>(context: SpacetimeDBContext<DbConnection>) {
  setContext<SpacetimeDBContext<DbConnection>>(SPACETIMEDB_CONTEXT_KEY, context);
}