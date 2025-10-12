# Deep Reactivity Fix for SpacetimeDB Svelte Bindings

## The Problem

The SpacetimeDB library (`DbConnectionImpl` class) internally mutates properties like `identity` and `isActive` asynchronously when the WebSocket connection is established:

```typescript
// Inside db_connection_impl.ts
case 'IdentityToken': {
  this.identity = message.identity;  // Direct mutation
  if (!this.token && message.token) {
    this.token = message.token;
  }
  this.connectionId = message.connectionId;
  this.#emitter.emit('connect', this, this.identity, this.token);
  break;
}

#handleOnOpen(): void {
  this.isActive = true;  // Direct mutation
}
```

### Why React Doesn't Have This Issue

In React, the entire connection object is returned from `useMemo`/`useState`, which means React tracks the object reference and re-renders when hooks run. React's reconciliation happens on the component level, not the data level.

### Why Svelte Had This Issue

Svelte 5's `$state()` creates deep reactive proxies for objects and arrays, but only for properties that are **already present** when the state is created. When the library asynchronously mutates properties on the connection object, Svelte doesn't detect these changes because:

1. The properties are mutated inside library code (outside Svelte's reactivity system)
2. The mutations happen asynchronously after the initial connection is created
3. Svelte's `$state()` wrapper wasn't intercepting writes to these specific properties

## The Solution: Reactive Proxy Pattern

We created a **custom reactive proxy** that intercepts reads and writes to the specific properties we need to track (`identity` and `isActive`):

```typescript
function createReactiveConnection<DbConnection extends DbConnectionImpl>(
  connection: DbConnection
): DbConnection {
  // Create reactive state for the properties we need to track
  let identity = $state<Identity | undefined>(connection.identity);
  let isActive = $state<boolean>(connection.isActive);
  
  // Create a proxy that intercepts reads and writes
  return new Proxy(connection, {
    get(target, prop, receiver) {
      // Intercept reads of identity and isActive to return our reactive state
      if (prop === 'identity') {
        return identity;
      }
      if (prop === 'isActive') {
        return isActive;
      }
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      // Intercept writes to update our reactive state
      if (prop === 'identity') {
        identity = value;
        return Reflect.set(target, prop, value, receiver);
      }
      if (prop === 'isActive') {
        isActive = value;
        return Reflect.set(target, prop, value, receiver);
      }
      return Reflect.set(target, prop, value, receiver);
    }
  }) as DbConnection;
}
```

### How It Works

1. **Proxy Creation**: When the `SpacetimeDBContext` is created, we wrap the connection in a Proxy
2. **Property Interception**: The Proxy intercepts all property reads and writes
3. **Reactive State**: For `identity` and `isActive`, we maintain separate `$state()` variables
4. **Automatic Updates**: When the library mutates `connection.identity` or `connection.isActive`, the Proxy:
   - Updates the reactive `$state()` variable
   - Also sets the actual property on the target object
   - Triggers Svelte's reactivity system

5. **Getter Convenience**: We expose `connected` and `identity` as getters on the context for easy access

### Benefits

✅ **No Event Binding Required**: Removed all the manual event handlers (`onConnect`, `onDisconnect`, etc.)  
✅ **Automatic Reactivity**: Changes to connection properties are automatically tracked  
✅ **Type Safe**: Full TypeScript support with proper typing  
✅ **Library Agnostic**: Works with any library that mutates object properties internally  
✅ **Performance**: Only specific properties are proxied, not the entire object  

## Simplified Code

### Before (with event binding)
```svelte
<script>
  onMount(() => {
    const clientWithEvents = spacetimeContext.connection as any;
    if (clientWithEvents.onConnect) {
      clientWithEvents.onConnect(() => {
        spacetimeContext.connected = true;
        spacetimeContext.identity = spacetimeContext.connection.identity;
      });
    }
    // More event handlers...
  });
</script>
```

### After (reactive proxy)
```typescript
const spacetimeContext = new SpacetimeDBContext(
  connectionBuilder.build()
);
// That's it! No event binding needed.
```

## Usage

Components can now simply access the reactive properties:

```svelte
<script>
  const context = getSpacetimeContext();
  
  // These automatically update when the library changes them
  $inspect('Connected:', context.connected);
  $inspect('Identity:', context.identity);
</script>
```

The `STQuery` class also benefits from this, as its `$effect` that watches `context.identity` now properly triggers when the identity changes asynchronously.

## Key Takeaway

When integrating third-party libraries that mutate objects internally, you may need to create custom reactive proxies to bridge the gap between the library's imperative mutations and Svelte's declarative reactivity system.
