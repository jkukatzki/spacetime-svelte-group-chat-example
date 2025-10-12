import { getContext, hasContext, setContext } from 'svelte';
import type { DbConnectionImpl, Identity } from 'spacetimedb';

export const SPACETIMEDB_CONTEXT_KEY = Symbol('spacetimedb');

export class SpacetimeDBContext<DbConnection extends DbConnectionImpl = DbConnectionImpl> {
  connection: DbConnection;
  error: Error | undefined = $state();
  
  // Reactive state that will be referenced by the connection's getters/setters
  #identity = $state<Identity | undefined>();
  #isActive = $state<boolean>(false);
  
  get identity(): Identity | undefined {
    return this.#identity;
  }
  
  get connected(): boolean {
    return this.#isActive;
  }

  constructor(connection: DbConnection) {
    // Store the original values
    this.#identity = connection.identity;
    this.#isActive = connection.isActive;
    
    // Replace the properties on the connection object with reactive getters/setters
    // This allows direct access to connection.identity and connection.isActive
    // while maintaining reactivity through our $state variables
    Object.defineProperty(connection, 'identity', {
      get: () => this.#identity,
      set: (value: Identity | undefined) => {
        this.#identity = value;
      },
      enumerable: true,
      configurable: true
    });
    
    Object.defineProperty(connection, 'isActive', {
      get: () => this.#isActive,
      set: (value: boolean) => {
        this.#isActive = value;
      },
      enumerable: true,
      configurable: true
    });
    
    this.connection = connection;
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