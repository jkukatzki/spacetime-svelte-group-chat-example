import { getContext, hasContext, setContext } from 'svelte';
import type { DbConnectionImpl, Identity } from 'spacetimedb';

export type ClientIdentity = Identity & { readonly __clientIdentityBrand: true };

function toClientIdentity(identity: Identity): ClientIdentity {
  if ((identity as any).__clientIdentityBrand) {
    return identity as ClientIdentity;
  }

  Object.defineProperty(identity, '__clientIdentityBrand', {
    value: true,
    enumerable: false,
    configurable: true
  });

  return identity as ClientIdentity;
}

export const SPACETIMEDB_CONTEXT_KEY = Symbol('spacetimedb');

export class SpacetimeDBContext<DbConnection extends DbConnectionImpl = DbConnectionImpl> {
  connection: DbConnection & { identity: ClientIdentity | undefined } = $state()!;
  error: Error | undefined = $state();
  // Reactive state that will be referenced by the connection's getters/setters
  #identity = $state<Identity | undefined>();
  #clientIdentity: ClientIdentity | undefined;
  #isActive = $state<boolean>(false);
  #connection: DbConnection | undefined;
  
  // Store the context key for this instance
  contextKey: symbol = SPACETIMEDB_CONTEXT_KEY;
  
  get identity(): Identity | undefined {
    return this.#identity;
  }
  
  get connected(): boolean {
    return this.#isActive;
  }

  constructor(connection?: DbConnection, contextKey?: symbol) {
    this.connection = this.#createPlaceholderConnection();
    if (contextKey) {
      this.contextKey = contextKey;
    }

    if (connection) {
      this.initializeConnection(connection);
    }
  }

  hasIdentity(): this is SpacetimeDBContextWithIdentity<DbConnection> {
    return this.#identity !== undefined;
  }

  // Public method to initialize the connection after construction
  initializeConnection(connection: DbConnection) {
    if (this.#connection === connection) {
      return;
    }

    // Store references to the original property descriptors before we overwrite them
    const originalIdentityDescriptor = Object.getOwnPropertyDescriptor(connection, 'identity');
    const originalIsActiveDescriptor = Object.getOwnPropertyDescriptor(connection, 'isActive');
    
    // Store the original values from the new connection BEFORE overwriting the properties
    const initialIdentity = connection.identity;
    const initialIsActive = connection.isActive;
    
    this.#identity = initialIdentity;
    this.#isActive = initialIsActive;
    
    // If identity exists, convert it to ClientIdentity
    if (this.#identity) {
      this.#clientIdentity = toClientIdentity(this.#identity);
    }
    
    // Delete existing property descriptors to ensure we can redefine them
    delete (connection as any).identity;
    delete (connection as any).isActive;
    
    // Replace the properties on the connection object with reactive getters/setters
    // This allows direct access to connection.identity and connection.isActive
    // while maintaining reactivity through our $state variables
    Object.defineProperty(connection, 'identity', {
      get: () => {
        const current = this.#identity;
        if (!current) {
          return undefined;
        }
        if (!this.#clientIdentity || this.#clientIdentity !== current) {
          this.#clientIdentity = toClientIdentity(current);
        }
        return this.#clientIdentity;
      },
      set: (value: Identity | undefined) => {
        this.#identity = value;
        if (value) {
          this.#clientIdentity = toClientIdentity(value);
        } else {
          this.#clientIdentity = undefined;
        }
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
    
    this.#connection = connection;
    // Update the connection reference to the real one with reactive properties
    this.connection = connection as DbConnection & { identity: ClientIdentity | undefined };
    
    // Store original descriptors for potential restoration
    (connection as any).__originalIdentityDescriptor = originalIdentityDescriptor;
    (connection as any).__originalIsActiveDescriptor = originalIsActiveDescriptor;
  }

  #createPlaceholderConnection(): DbConnection & { identity: ClientIdentity | undefined } {
    const ctx = this;

    const noop = () => {};
    const placeholderSubscriptionBuilder = () => ({
      onApplied: () => placeholderSubscriptionBuilder(),
      subscribe: () => ({ unsubscribe: noop })
    });

    const reducersProxy = new Proxy(
      {},
      {
        get:
          () =>
          (..._args: unknown[]) => {
            throw new Error('SpacetimeDB connection not initialized yet');
          }
      }
    );

    const placeholder: any = {
      get identity() {
        return ctx.#clientIdentity;
      },
      set identity(value: Identity | undefined) {
        ctx.#identity = value;
        ctx.#clientIdentity = value ? toClientIdentity(value) : undefined;
      },
      get isActive() {
        return ctx.#isActive;
      },
      set isActive(value: boolean) {
        ctx.#isActive = value;
      },
      subscriptionBuilder: () => placeholderSubscriptionBuilder(),
      reducers: reducersProxy,
      setReducerFlags: new Proxy({}, { get: () => noop }),
      db: new Proxy(
        {},
        {
          get: () => undefined
        }
      ),
      disconnect: noop
    };

    return placeholder as DbConnection & { identity: ClientIdentity | undefined };
  }
}

export type SpacetimeDBContextWithIdentity<
  DbConnection extends DbConnectionImpl = DbConnectionImpl
> = SpacetimeDBContext<DbConnection> & {
  connection: DbConnection & { identity: ClientIdentity };
  identity: ClientIdentity;
};


/**
 * Get the full SpacetimeDB context including connection state and errors.
 * Similar to how useThrelte provides the full ThrelteContext.
 * 
 * This retrieves the context stored by the nearest SpacetimeDBProvider ancestor.
 * The context is retrieved using the contextKey stored in the context itself.
 * 
 * @param contextKey - Optional custom context key. If not provided, uses default key.
 * @returns The complete SpacetimeDB context
 */
export function getSpacetimeContext<DbConnection extends DbConnectionImpl = DbConnectionImpl>(contextKey: symbol = SPACETIMEDB_CONTEXT_KEY): SpacetimeDBContext<DbConnection> {
  if (!hasContext(contextKey)) {
    throw new Error(
      'getSpacetimeContext must be used within a SpacetimeDBProvider component. Did you forget to add a `SpacetimeDBProvider` to your component tree?'
    );
  }
  
  const context = getContext<SpacetimeDBContext<DbConnection>>(contextKey);
  
  return context;
}

export function setSpacetimeContext<DbConnection extends DbConnectionImpl = DbConnectionImpl>(context: SpacetimeDBContext<DbConnection>, contextKey: symbol = SPACETIMEDB_CONTEXT_KEY) {
  setContext<SpacetimeDBContext<DbConnection>>(contextKey, context);
}
