<script lang="ts">
  import { browser } from '$app/environment';
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import type { DbConnectionImpl } from 'spacetimedb';
	import { SpacetimeDBContext, setSpacetimeContext, SPACETIMEDB_CONTEXT_KEY } from './SpacetimeContext.svelte';
  
  interface Props<
    DbConnection extends DbConnectionImpl,
  > {
    // The DbConnection class with static builder() method
    dbConnection: { builder: () => any };
    // Connection parameters
    uri: string | URL;
    moduleName: string;
    token?: string;
    // Optional callbacks
    onConnect?: (connection: DbConnection, identity: any, token: string) => void;
    onConnectError?: (error: Error) => void;
    onDisconnect?: (error?: Error) => void;
    children: Snippet;
  }

  let { 
    dbConnection,
    uri,
    moduleName,
    token,
    onConnect,
    onConnectError,
    onDisconnect,
    children,
  }: Props<any> = $props();

  // Global storage using module name as key
  // This allows multiple connections but prevents duplicates to the same module
  const GLOBAL_CONNECTIONS_SYMBOL = Symbol.for('spacetime:global_connections');
  const GLOBAL_REFCOUNTS_SYMBOL = Symbol.for('spacetime:global_refcounts');
  const GLOBAL_BUILDING_SYMBOL = Symbol.for('spacetime:global_building');

  // Use globalThis to ensure true cross-module singleton
  const globalStore = globalThis as any;

  // Initialize maps if they don't exist
  if (!globalStore[GLOBAL_CONNECTIONS_SYMBOL]) {
    globalStore[GLOBAL_CONNECTIONS_SYMBOL] = new Map();
  }
  if (!globalStore[GLOBAL_REFCOUNTS_SYMBOL]) {
    globalStore[GLOBAL_REFCOUNTS_SYMBOL] = new Map();
  }
  if (!globalStore[GLOBAL_BUILDING_SYMBOL]) {
    globalStore[GLOBAL_BUILDING_SYMBOL] = new Set();
  }

  const connections = globalStore[GLOBAL_CONNECTIONS_SYMBOL]!;
  const refCounts = globalStore[GLOBAL_REFCOUNTS_SYMBOL]!;
  const buildingSet = globalStore[GLOBAL_BUILDING_SYMBOL]!;

  // Always start with undefined connection to prevent double connections during SSR hydration
  // The real connection will be built in onMount after hydration is complete
  const spacetimeContext: SpacetimeDBContext = new SpacetimeDBContext();

  // Set context with the default key
  // Svelte's context API automatically isolates this to the component subtree
  setSpacetimeContext(spacetimeContext, SPACETIMEDB_CONTEXT_KEY);

  onMount(() => {
    // Delay connection building to ensure hydration is complete
    // This prevents double connections when SSR rehydrates
    const timeoutId = setTimeout(() => {
      // Prevent concurrent connection building using global flag
      if (buildingSet.has(moduleName)) {
        // Another instance is already building, wait for it
        const checkInterval = setInterval(() => {
          const existingConnection = connections.get(moduleName);
          if (existingConnection && !buildingSet.has(moduleName)) {
            clearInterval(checkInterval);
            refCounts.set(moduleName, (refCounts.get(moduleName) ?? 0) + 1);
            spacetimeContext.initializeConnection(existingConnection);
          }
        }, 10);
        return;
      }

      let connection = connections.get(moduleName);
      if (!connection) {
        // Set building flag to prevent concurrent builds
        buildingSet.add(moduleName);
        
        // Build the connection builder with the provided parameters
        let builder = dbConnection.builder()
          .withUri(uri)
          .withModuleName(moduleName);
        
        if (token) {
          builder = builder.withToken(token);
        }
        
        if (onConnect) {
          builder = builder.onConnect(onConnect);
        }
        
        if (onConnectError) {
          builder = builder.onConnectError(onConnectError as any);
        }
        
        if (onDisconnect) {
          builder = builder.onDisconnect(onDisconnect as any);
        }
        
        connection = builder.build();
        connections.set(moduleName, connection);
        refCounts.set(moduleName, 0);
        buildingSet.delete(moduleName);
      }

      refCounts.set(moduleName, (refCounts.get(moduleName) ?? 0) + 1);

      // Initialize the context with the connection
      spacetimeContext.initializeConnection(connection);
      
      // Set up connection event handlers to update reactive state
      const clientWithEvents = connection as any;
      if (clientWithEvents.onConnect) {
        clientWithEvents.onConnect(() => {
          const possibleIdentities = [
            (connection as any).__identity__,
            (connection as any)._identity,
            clientWithEvents.__identity__,
            clientWithEvents._identity
          ];
          
          const actualIdentity = possibleIdentities.find(id => id !== undefined);
          
          if (actualIdentity) {
            spacetimeContext.connection.identity = actualIdentity;
          }
          spacetimeContext.connection.isActive = true;
        });
      }
      
      if (clientWithEvents.onDisconnect) {
        clientWithEvents.onDisconnect(() => {
          spacetimeContext.connection.isActive = false;
        });
      }
    }, 0);

    return () => clearTimeout(timeoutId);
  });

  onDestroy(() => {
    // Only manage connection lifecycle on the client
    if (browser && spacetimeContext.connection) {
      const currentRefCount = (refCounts.get(moduleName) ?? 1) - 1;
      refCounts.set(moduleName, currentRefCount);
      
      if (currentRefCount <= 0) {
        const conn = connections.get(moduleName);
        if (conn) {
          conn.disconnect();
        }
        connections.delete(moduleName);
        refCounts.delete(moduleName);
      }
    }
  });
</script>

{@render children()}
