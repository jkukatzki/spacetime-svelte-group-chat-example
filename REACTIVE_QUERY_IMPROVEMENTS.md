# Reactive Query Improvements

## Problem: Creating STQuery in $derived

When you create a new `STQuery` instance inside a `$derived`, it doesn't work properly because:

1. **New instance on every recalculation**: Each time the `$derived` recalculates, it creates a brand new `STQuery` instance
2. **Subscription churn**: New subscriptions are created and old ones may not be cleaned up properly
3. **Lost state**: The new instance starts with empty rows, breaking reactivity
4. **Performance**: Unnecessary WebSocket subscriptions are created and destroyed

### ❌ Don't do this:

```svelte
let clientUser: User | undefined = $derived(
  new STQuery<DbConnection, User>('user', where(isClient('identity'))).rows[0]
);
```

## Solution: Use `firstRow` getter

We added a `firstRow` getter to `STQuery` that:
- Returns the first row (or `undefined` if no rows exist)
- Is fully reactive (uses the same subscription mechanism as `rows`)
- Registers cleanup automatically via `createSubscriber`
- Provides a cleaner API for single-result queries

### ✅ Do this instead:

```svelte
// Create the STQuery instance once
let clientUserTable = new STQuery<DbConnection, User>('user', where(isClient('identity')));

// Derive the specific value you need
let clientUser: User | undefined = $derived(clientUserTable.firstRow);
```

## How it works

The `firstRow` getter:

1. **Calls `this.subscribe()`**: Registers the current effect for cleanup (same as `rows`)
2. **Returns `this.#actualRows[0]`**: Gets the first element from the reactive array
3. **Updates automatically**: When the subscription receives updates, `#actualRows` changes, triggering Svelte's reactivity

```typescript
get firstRow(): RowType | undefined {
  // Register this access with the subscriber (same as rows getter)
  this.subscribe();
  return this.#actualRows[0];
}
```

## Benefits

✅ **Single instance**: STQuery is created once, not on every render  
✅ **Proper cleanup**: Subscription is managed by `createSubscriber`  
✅ **Fully reactive**: Changes propagate automatically through Svelte's reactivity  
✅ **Type-safe**: Returns `RowType | undefined`  
✅ **Cleaner code**: More semantic than `.rows[0]`  

## Usage Examples

### Single user query
```svelte
let clientUserTable = new STQuery<DbConnection, User>('user', where(isClient('identity')));
let clientUser = $derived(clientUserTable.firstRow);

{#if clientUser}
  <p>Hello, {clientUser.name}!</p>
{/if}
```

### With conditional logic
```svelte
let selectedChatMessages = new STQuery<DbConnection, Message>(
  'message', 
  where(eq('groupchatId', selectedChat?.id))
);

let latestMessage = $derived(selectedChatMessages.firstRow);
```

## Key Takeaway

**Never create reactive objects (like STQuery) inside `$derived` or `$effect`.** 

Instead:
1. Create the reactive object once (as a regular variable)
2. Derive specific values from it using `$derived`
3. Use helper getters like `firstRow` for common patterns
