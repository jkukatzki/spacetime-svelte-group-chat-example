# SpacetimeDB + Svelte 5 (requires "svelte": "^5.39.11")

### WORK IN PROGRESS - FOR BUG REPORTS AND FEATURE REQUESTS FILE AN ISSUE ###
### NO FINAL DESIGN DECISIONS HAVE BEEN MADE, FEEL FREE TO SUGGEST CHANGES ###
### THE BINDINGS WILL BE IN A SEPARATE PACKAGE IN THE FUTURE ###
A reactive, type-safe integration layer for SpacetimeDB with Svelte 5's runes system. 

<p align="center">
  <img width="60%" alt="dog_groupchat" src="https://github.com/user-attachments/assets/0190bdd8-65e9-46ec-8b9c-bde20a09bca3" />
</p>

[If you just wanna look at the example](frontend/src/App.svelte)

[If you just wanna copy the binding code](frontend/src/lib/components/spacetime/svelte_spacetime)


The `SpacetimeDBProvider` component wraps your app and provides the SpacetimeDB connection to all child components. It manages the connection by connecting and disconnecting on component lifecycle events and makes it available through Svelte's context system.

#### SpacetimeDBProvider.svelte

```svelte
<script lang="ts">
  import { SpacetimeDBProvider } from './lib/components/spacetime/svelte_spacetime';
  import { DbConnection } from './lib/components/spacetime/module_bindings';

  const connectionBuilder = DbConnection.builder()
    .withUri('ws://localhost:3000')
    .withModuleName('your_module_name')
    .onConnect((token, identity) => {
      console.log('Connected!', identity);
    });
</script>

<SpacetimeDBProvider {connectionBuilder}>
  <!-- Your app components go here -->
  <YourApp />
</SpacetimeDBProvider>
```

#### SpacetimeContext.svelte

```svelte
<script lang="ts">
  import { getSpacetimeContext } from './lib/components/spacetime/svelte_spacetime/SpacetimeContext.svelte';
  import type { DbConnection } from './lib/components/spacetime/module_bindings';

  // call this anywhere inside a child of SpacetimeDBProvider
  let spacetimeContext = getSpacetimeContext<DbConnection>();
</script>

<!-- isActive and identity are reactive states and can be used like this: -->
<div>
  {spacetimeContext.connection.isActive ? '🟢 Connected' : '🔴 Disconnected'}
  {spacetimeContext.connection.identity?.toHexString() ?? ''}
</div>
```

---

#### STQuery.svelte.ts

`STQuery` is the main class for querying SpacetimeDB tables reactively. It provides:

- **Type-safe queries** with full TypeScript support
- **Automatic subscriptions** that clean up when no longer needed
- **Reactive state** on its .rows variable
- **WHERE clause filtering** with type-checked column names
- **Per Query client side filtering** the spacetimeDB sdk compiles all queries into one but the rows inside the query are filtered according to the where clause

### Constructor

```typescript
constructor(
  tableName: string, // Table name ( accepts camelCase or snake_case)
  whereClause?: Expr<ColumnName>, // Optional filter expression
)
```
```svelte
<script lang="ts">
  import { STQuery } from './lib/components/spacetime/svelte_spacetime';
  import { DbConnection, User } from './lib/components/spacetime/module_bindings';

  let selectedGroupChat: GroupChat | undefined = $state();

  // Simple query - get all groupchats
  let groupchats = new STQuery<DbConnection, GroupChat>('groupchat');
  // this typo would throw a compile error 🐈
  // let groupchats = new STQuery<DbConnection, GroupChat>('groupcat');
</script>

<ul>
  {#each groupchats.rows as groupchat}
    <li onclick={() => selectedGroupChat = groupchat}>
      {groupchat.id}
    </li>
  {/each}
</ul>
```

### With reactive WHERE Clause

#### This example shows the reconstruction of the class when a rune inside the derived changes, this workflow might be replaced by creating a new class with reactive states describing the WHERE clause and listening to changes inside the STQuery class. (This would prevent unnecessary reconstruction if we're just trying to query by distance to other objects or chunk id in a game)
But for now:

```svelte
// Filtered query - get messages for specific group chat
let groupChatMessages = $derived.by(() => {
  if(!selectedGroupChat) {
    return null;
  } else {
    return new STQuery<DbConnection, Message>('message',
      where(eq('groupchatId', selectedGroupChat.id)))
    );
  }
);
```

## Query Building with WHERE Clauses

Build complex queries using type-safe helper functions. Value accepts Identity types as well and are converted to the correct hexstring representation.

### Available Operators

```typescript
import { where, eq, and, or, not, isClient } from './lib/components/spacetime/svelte_spacetime';
```

#### `eq(column, value)` - Equality

```typescript
where(eq('groupchatId', 123))
// SQL: WHERE groupchat_id = 123
```
### NOT INCLUDED IN REACT IMPLEMENTATION
#### since we cannot query by optional column values, undefined is prohibited as a value, but as identity is only defined once we connect the isClient helper function is provided to avoid boilerplate code and listens to the change inside of STQuery
#### `isClient(column)` - Match Client Identity 

```typescript
where(isClient('identity'))
// SQL: WHERE identity = <current_user_identity>
```

### NOT INCLUDED IN REACT IMPLEMENTATION
#### `not(expression)` - Negation

```typescript
where(not(isClient('identity')))
// SQL: WHERE identity != <current_user_identity>
```

#### `and(...expressions)` - Logical AND

```typescript
where(and(
  eq('groupchatId', 123),
  not(isClient('identity'))
))
// SQL: WHERE groupchat_id = 123 AND identity != <current_user_identity>
```

#### `or(...expressions)` - Logical OR

```typescript
where(or(
  eq('groupchatId', 123),
  eq('groupchatId', 456)
))
// SQL: WHERE groupchat_id = 123 OR groupchat_id = 456
```

### Complex Example

```typescript
// Get messages from multiple group chats, excluding the current user's messages
let messages = new STQuery<DbConnection, Message>(
  'message',
  where(
    and(
      or(
        eq('groupchatId', 123),
        eq('groupchatId', 456),
        eq('groupchatId', 789)
      ),
      not(isClient('sender'))
    )
  )
);
```

---

## Event Callbacks

Since we track state dependencies (like the .rows variable) to clean up the STDB Subscription once they are not needed anymore and there might be cases where you don't need the rows but just want to add callbacks we add dependencies by using an effect to bind to the event callbacks.
I couldn't think of a cleaner way to do this in svelte so feel free to suggest improvements to this system.

```svelte
<script lang="ts">
  import { STQuery } from './lib/components/spacetime/svelte_spacetime';
  import { DbConnection, Message } from './lib/components/spacetime/module_bindings';

  let messages = $derived(
    new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat.id)))
  );

  // Register event handlers in an effect
  $effect(() => {
    if (messages) {
      messages.events.onInsert((newMessage) => {
        console.log('New message:', newMessage.text);
        showNotification(newMessage);
      });
      
      messages.events.onDelete((deletedMessage) => {
        console.log('Message deleted:', deletedMessage.id);
      });
      
      messages.events.onUpdate((oldMessage, newMessage) => {
        console.log('Message edited:', oldMessage.text, '->', newMessage.text);
      });
    }
  });
</script>
```
