<script lang="ts">
  import { browser } from '$app/environment';
  import { hasContext, onDestroy, onMount, type Snippet } from 'svelte';
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

  // Check if we're nested inside another SpacetimeDBProvider
  if (hasContext(SPACETIMEDB_CONTEXT_KEY)) {
    console.warn(
      `⚠️ WARNING: SpacetimeDBProvider with moduleName="${moduleName}" is nested inside another SpacetimeDBProvider.\n` +
      `This can lead to unexpected behavior as child components will use the nearest parent context.\n` +
      `Consider:\n` +
      `  1. Placing providers as siblings instead of nested\n` +
      `  2. Restructuring your component tree to avoid nesting`
    );
  }

  // Always start with undefined connection to prevent double connections during SSR hydration
  // The real connection will be built in onMount after hydration is complete
  const spacetimeContext: SpacetimeDBContext = new SpacetimeDBContext();

  // Set context with the default key
  // Svelte's context API automatically isolates this to the component subtree
  setSpacetimeContext(spacetimeContext, SPACETIMEDB_CONTEXT_KEY);

  // Track the current connection parameters to detect changes
  let currentModuleName = $state<string | undefined>(undefined);
  let currentUri = $state<string | undefined>(undefined);
  let currentToken = $state<string | undefined>(undefined);
  let mounted = $state(false);

  // Helper function to build or get a connection
  function getOrBuildConnection(moduleName: string) {
    // Prevent concurrent connection building using global flag
    if (buildingSet.has(moduleName)) {
      // Another instance is already building, wait for it
      return new Promise<any>((resolve) => {
        const checkInterval = setInterval(() => {
          const existingConnection = connections.get(moduleName);
          if (existingConnection && !buildingSet.has(moduleName)) {
            clearInterval(checkInterval);
            resolve(existingConnection);
          }
        }, 10);
      });
    }

    let connection = connections.get(moduleName);
    const isNewConnection = !connection;
    
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

    return Promise.resolve({ connection, isNewConnection });
  }

  // Helper function to cleanup old connection
  function cleanupConnection(moduleName: string) {
    if (!browser) return;
    
    const oldRefCount = refCounts.get(moduleName) ?? 1;
    const currentRefCount = oldRefCount - 1;
    refCounts.set(moduleName, currentRefCount);
    console.log(`🔻 Decremented refCount for ${moduleName}: ${oldRefCount} -> ${currentRefCount}`);
    
    if (currentRefCount <= 0) {
      const conn = connections.get(moduleName);
      if (conn) {
        console.log(`🔌 Disconnecting ${moduleName}`);
        conn.disconnect();
      }
      connections.delete(moduleName);
      refCounts.delete(moduleName);
      console.log(`🗑️ Deleted connection for ${moduleName}`);
    }
  }

  // React to prop changes
  $effect(() => {
    if (!mounted) return;

    const targetModule = moduleName;
    const targetUri = typeof uri === 'string' ? uri : uri.toString();
    const targetToken = token;
    
    console.log(`🔄 Effect running for module: ${targetModule}, uri: ${targetUri}, token: ${targetToken}`);

    // Check if anything changed
    const moduleChanged = currentModuleName !== targetModule;
    const uriChanged = currentUri !== targetUri;
    const tokenChanged = currentToken !== targetToken;
    
    if (!moduleChanged && !uriChanged && !tokenChanged) {
      console.log(`⏭️ No changes detected, skipping`);
      return;
    }

    // If URI or token changed but module name is the same, we need to disconnect and reconnect
    // If module name changed, we need to cleanup the old module
    if (currentModuleName && (moduleChanged || uriChanged || tokenChanged)) {
      console.log(`🧹 Cleaning up old connection: module=${currentModuleName}, moduleChanged=${moduleChanged}, uriChanged=${uriChanged}, tokenChanged=${tokenChanged}`);
      cleanupConnection(currentModuleName);
    }

    // Update tracking immediately to prevent race conditions
    currentModuleName = targetModule;
    currentUri = targetUri;
    currentToken = targetToken;

    // Build or get connection for new module
    getOrBuildConnection(targetModule).then(({ connection, isNewConnection }) => {
      // Only proceed if we haven't switched to a different module in the meantime
      if (currentModuleName !== targetModule) {
        console.log(`⚠️ Aborted - switched away from ${targetModule} to ${currentModuleName}`);
        return;
      }

      const newRefCount = (refCounts.get(targetModule) ?? 0) + 1;
      refCounts.set(targetModule, newRefCount);
      console.log(`✅ Connected to ${targetModule}, isNew: ${isNewConnection}, refCount: ${newRefCount}, isActive: ${connection.isActive}`);
      spacetimeContext.initializeConnection(connection);
      
      // Only set up connection event handlers for new connections
      // Otherwise we'd register duplicate handlers on every switch
      if (isNewConnection) {
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
      } else {
        // For existing connections, sync the current state
        spacetimeContext.connection.isActive = (connection as any).isActive ?? false;
        spacetimeContext.connection.identity = (connection as any).identity;
      }
    });
  });

  onMount(() => {
    // Delay slightly to ensure hydration is complete
    const timeoutId = setTimeout(() => {
      mounted = true;
    }, 0);

    return () => clearTimeout(timeoutId);
  });

  onDestroy(() => {
    // Cleanup current connection on unmount
    if (currentModuleName) {
      cleanupConnection(currentModuleName);
    }
  });
</script>

{@render children()}
