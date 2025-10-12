# SpacetimeDB + Svelte 5 Integration Guide

A reactive, type-safe integration layer for SpacetimeDB with Svelte 5's runes system. This guide covers the core components and patterns for building real-time applications with SpacetimeDB and Svelte 5.

---

## Table of Contents

- [Setup: SpacetimeDBProvider](#setup-spacetimedbprovider)
- [Core Concepts: STQuery](#core-concepts-stquery)
- [Type Safety and Autocomplete](#type-safety-and-autocomplete)
- [Query Building with WHERE Clauses](#query-building-with-where-clauses)
- [Reactive Queries with $derived](#reactive-queries-with-derived)
- [Event Handling](#event-handling)
- [The isClient Helper](#the-isclient-helper)
- [Best Practices](#best-practices)

---

## Setup: SpacetimeDBProvider

The `SpacetimeDBProvider` component wraps your app and provides the SpacetimeDB connection to all child components. It manages the connection lifecycle and makes it available through Svelte's context system.

### Basic Setup

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

### What it Does

1. **Creates the connection** - Builds and manages the SpacetimeDB connection
2. **Provides reactive context** - Makes `identity` and `isActive` reactive through Svelte's `$state`
3. **Handles cleanup** - Automatically disconnects when the component unmounts

### Accessing the Context

```svelte
<script lang="ts">
  import { getSpacetimeContext } from './lib/components/spacetime/svelte_spacetime/SpacetimeContext.svelte';
  import type { DbConnection } from './lib/components/spacetime/module_bindings';

  let spacetimeContext = getSpacetimeContext<DbConnection>();
  
  // Access reactive connection state
  let isConnected = $derived(spacetimeContext.connection.isActive);
  let userIdentity = $derived(spacetimeContext.connection.identity);
</script>

<div>
  {isConnected ? '🟢 Connected' : '🔴 Disconnected'}
</div>
```

---

## Core Concepts: STQuery

`STQuery` is the main class for querying SpacetimeDB tables reactively. It provides:

- ✅ **Type-safe queries** with full TypeScript support
- ✅ **Automatic subscriptions** that clean up when no longer needed
- ✅ **Reactive state** using Svelte 5's `$state` rune
- ✅ **WHERE clause filtering** with type-checked column names
- ✅ **Event callbacks** for onInsert, onDelete, onUpdate

### Constructor

```typescript
constructor(
  tableName: string,                    // Table name (camelCase or snake_case)
  whereClause?: Expr<ColumnName>,       // Optional filter expression
  callbacks?: {                         // Optional event callbacks (legacy)
    onInsert?: (row: RowType) => void,
    onDelete?: (row: RowType) => void,
    onUpdate?: (oldRow: RowType, newRow: RowType) => void
  }
)
```

### Basic Usage

```svelte
<script lang="ts">
  import { STQuery } from './lib/components/spacetime/svelte_spacetime';
  import { DbConnection, User } from './lib/components/spacetime/module_bindings';

  // Simple query - get all users
  let users = new STQuery<DbConnection, User>('user');
</script>

<ul>
  {#each users.rows as user}
    <li>{user.name}</li>
  {/each}
</ul>
```

### With WHERE Clause

```svelte
<script lang="ts">
  import { STQuery, where, eq } from './lib/components/spacetime/svelte_spacetime';
  import { DbConnection, Message } from './lib/components/spacetime/module_bindings';

  let groupChatId = 123;
  
  // Filtered query - get messages for specific group chat
  let messages = new STQuery<DbConnection, Message>(
    'message',
    where(eq('groupchatId', groupChatId))
  );
</script>

<div>
  {#each messages.rows as msg}
    <p>{msg.text}</p>
  {/each}
</div>
```

---

## Type Safety and Autocomplete

One of the most powerful features is full TypeScript support with autocomplete for table and column names.

### Table Name Autocomplete

![Screenshot: Table name autocomplete showing available tables]
<!-- Add screenshot showing IDE autocomplete for table names -->

The first parameter to `STQuery` provides autocomplete for all available tables:

```typescript
// ✅ Autocomplete shows: 'user', 'message', 'groupchat', 'groupchatMembership'
let query = new STQuery<DbConnection, User>('user');
```

### Column Name Autocomplete

![Screenshot: Column name autocomplete in WHERE clauses]
<!-- Add screenshot showing IDE autocomplete for column names in eq() -->

Column names in WHERE clauses are type-checked against the row type:

```typescript
// ✅ Autocomplete shows: 'id', 'groupchatId', 'text', 'sender', 'createdAt'
let messages = new STQuery<DbConnection, Message>(
  'message',
  where(eq('groupchatId', 123))  // IDE suggests valid column names
);
```

### Type Safety for Values

![Screenshot: Type error when using wrong value type]
<!-- Add screenshot showing TypeScript error for wrong value type -->

Values are type-checked against column types:

```typescript
// ❌ Type error: 'groupchatId' expects number, got string
let messages = new STQuery<DbConnection, Message>(
  'message',
  where(eq('groupchatId', '123'))  // Error: Type 'string' is not assignable to type 'number'
);

// ✅ Correct
let messages = new STQuery<DbConnection, Message>(
  'message',
  where(eq('groupchatId', 123))
);
```

---

## Query Building with WHERE Clauses

Build complex queries using type-safe helper functions.

### Available Operators

```typescript
import { where, eq, not, and, or, isClient } from './lib/components/spacetime/svelte_spacetime';
```

#### `eq(column, value)` - Equality

```typescript
where(eq('groupchatId', 123))
// SQL: WHERE groupchat_id = 123
```

#### `isClient(column)` - Match Client Identity

```typescript
where(isClient('identity'))
// SQL: WHERE identity = <current_user_identity>
```

See [The isClient Helper](#the-isclient-helper) for more details.

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

## Reactive Queries with $derived

One of the most powerful patterns is using `$derived` to reactively create queries that update when dependencies change.

### Why Use $derived?

When you need a query whose WHERE clause depends on reactive state, use `$derived` to automatically recreate the query when that state changes.

```svelte
<script lang="ts">
  import { STQuery, where, eq } from './lib/components/spacetime/svelte_spacetime';
  import { DbConnection, Message, GroupChat } from './lib/components/spacetime/module_bindings';

  let selectedGroupChat: GroupChat | undefined = $state();
  
  // ❌ Wrong: This query never updates when selectedGroupChat changes
  let messages = new STQuery<DbConnection, Message>(
    'message',
    where(eq('groupchatId', selectedGroupChat?.id ?? 0))
  );
  
  // ✅ Correct: Query is recreated whenever selectedGroupChat changes
  let messages = $derived(
    selectedGroupChat 
      ? new STQuery<DbConnection, Message>(
          'message',
          where(eq('groupchatId', selectedGroupChat.id))
        )
      : null
  );
</script>

<!-- The messages update automatically when you change selectedGroupChat -->
{#if messages}
  {#each messages.rows as msg}
    <p>{msg.text}</p>
  {/each}
{/if}
```

### Why undefined is Not an Option

You might wonder: why use `null` instead of allowing the variable to be `undefined`?

```typescript
// ❌ This won't work as expected
let messages: STQuery<DbConnection, Message> | undefined = $derived(
  selectedGroupChat 
    ? new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat.id)))
    : undefined
);
```

**Reason:** In Svelte 5, `$derived` tracks the expression and its dependencies. When the variable is `undefined`, accessing `.rows` would cause a runtime error. Using `null` is more explicit and makes it clear in your template that you need to check for existence:

```svelte
<!-- Explicit null check is cleaner and more idiomatic -->
{#if messages}
  {#each messages.rows as msg}
    <p>{msg.text}</p>
  {/each}
{/if}
```

### Dynamic Multi-Table Queries

Here's a real-world example from the chat app - listening to messages from all group chats except the currently selected one:

```typescript
let clientMemberships = new STQuery<DbConnection, GroupChatMembership>(
  'groupchatMembership',
  where(isClient('identity'))
);

let selectedGroupChat: GroupChat | undefined = $state();

// Dynamically filter messages based on:
// 1. Which group chats the user is a member of
// 2. Exclude the currently selected group chat
let notificationMessages = $derived.by(() => {
  if (clientMemberships.rows.length === 0) {
    return null;
  }
  
  return new STQuery<DbConnection, Message>(
    'message',
    where(
      or(...clientMemberships.rows
        .filter(m => m.groupchatId !== selectedGroupChat?.id)
        .map(m => eq('groupchatId', m.groupchatId))
      )
    )
  );
});
```

**What's happening:**
1. `clientMemberships.rows` is read, creating a dependency
2. When memberships change, the query is recreated
3. When `selectedGroupChat` changes, the query is recreated
4. Old query automatically cleans up, new one subscribes

---

## Event Handling

STQuery provides two ways to handle database events: constructor callbacks (legacy) and the new `.events` API.

### The .events API (Recommended)

The `.events` API provides a cleaner way to handle database events and is the recommended approach.

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

### Why Event Binding Needs an $effect

**Important:** Event handlers must be registered inside an `$effect` to maintain the subscription.

```typescript
// ❌ Wrong: Events won't fire consistently
if (messages) {
  messages.events.onInsert((msg) => console.log(msg));
}

// ✅ Correct: Effect keeps subscription alive
$effect(() => {
  if (messages) {
    messages.events.onInsert((msg) => console.log(msg));
  }
});
```

**Why?** 

STQuery uses Svelte's `createSubscriber` for automatic cleanup. When you call `messages.events.onInsert()`, it:

1. Calls `createSubscriber()` internally
2. Registers the current effect as a subscriber
3. Keeps the SpacetimeDB subscription alive as long as the effect is active
4. Automatically unsubscribes when the effect is destroyed

Without an `$effect`, there's no reactive context to track, so the subscription would be cleaned up immediately.

**What happens when the query changes:**

```typescript
let groupId = $state(1);

// When groupId changes from 1 to 2:
let messages = $derived(
  new STQuery<DbConnection, Message>('message', where(eq('groupchatId', groupId)))
);

$effect(() => {
  if (messages) {
    messages.events.onInsert((msg) => console.log(msg));
  }
});
```

1. New `STQuery` for groupId=2 is created
2. Old `STQuery` for groupId=1 is destroyed
3. Old effect is cleaned up (old subscription ends)
4. New effect runs (new subscription starts)
5. You now only receive messages for groupId=2

### Real-World Example: Notification System

```svelte
<script lang="ts">
  // Get messages from all group chats except the currently selected one
  let notificationMessages = $derived.by(() => {
    if (clientMemberships.rows.length === 0) return null;
    
    return new STQuery<DbConnection, Message>(
      'message',
      where(
        or(...clientMemberships.rows
          .filter(m => m.groupchatId !== selectedGroupChat?.id)
          .map(m => eq('groupchatId', m.groupchatId))
        )
      )
    );
  });

  // Show toast notification for new messages
  $effect(() => {
    if (notificationMessages) {
      notificationMessages.events.onInsert((newMessage) => {
        const sender = users.rows.find(u => u.identity.isEqual(newMessage.sender));
        if (sender) {
          showToast({
            title: sender.name,
            message: newMessage.text,
            groupChatId: newMessage.groupchatId
          });
        }
      });
    }
  });
</script>
```

### Constructor Callbacks (Legacy)

You can also pass callbacks directly to the constructor, but this is less flexible:

```typescript
let messages = new STQuery<DbConnection, Message>(
  'message',
  where(eq('groupchatId', 123)),
  {
    onInsert: (msg) => console.log('New:', msg),
    onDelete: (msg) => console.log('Deleted:', msg),
    onUpdate: (old, new) => console.log('Updated:', old, '->', new)
  }
);
```

**Limitation:** You can't change callbacks without recreating the entire query. Use `.events` API for dynamic callback registration.

---

## The isClient Helper

The `isClient` helper is a special query function that compares a column against the current user's identity.

### Basic Usage

```typescript
// Get rows where the identity column matches the current user
let myMemberships = new STQuery<DbConnection, GroupChatMembership>(
  'groupchatMembership',
  where(isClient('identity'))
);
```

### Why Not Use eq Directly?

You might think to write:

```typescript
// ❌ This won't work!
let myMemberships = new STQuery<DbConnection, GroupChatMembership>(
  'groupchatMembership',
  where(eq('identity', spacetimeContext.connection.identity))  // identity might be undefined!
);
```

**Problem:** `spacetimeContext.connection.identity` is `undefined` until the connection is established. By the time you have an identity, the query has already been created with `undefined`.

### How isClient Works

```typescript
export const isClient = <Column extends string>(
  key: Column
): Expr<Column> => ({ type: 'isClient', key });
```

The `isClient` function:

1. **Defers identity lookup** - Doesn't read the identity immediately
2. **Evaluates at query time** - Checks identity when the SQL query is generated
3. **Handles connection state** - Works correctly even before connection is established

### Under the Hood

When STQuery generates the SQL query:

```typescript
// Your code:
where(isClient('identity'))

// Becomes (internally, when connection is ready):
where(eq('identity', currentIdentity))

// SQL output:
// WHERE identity = 0x1234...
```

### Common Patterns

#### Get Current User's Data

```typescript
// Get the current user's profile
let clientUser = new STQuery<DbConnection, User>(
  'user',
  where(isClient('identity'))
);

let currentUser = $derived(clientUser.rows[0]);
```

#### Exclude Current User

```typescript
// Get all group chat members except the current user
let otherMembers = new STQuery<DbConnection, GroupChatMembership>(
  'groupchatMembership',
  where(and(
    eq('groupchatId', selectedGroupChat.id),
    not(isClient('identity'))
  ))
);
```

#### Complex Filtering

```typescript
// Get messages from others in the current group chat
let messagesFromOthers = new STQuery<DbConnection, Message>(
  'message',
  where(and(
    eq('groupchatId', currentGroupChatId),
    not(isClient('sender'))  // sender is an Identity column
  ))
);
```

---

## Best Practices

### 1. Use $derived for Dynamic Queries

```typescript
// ✅ Good: Query updates when dependencies change
let messages = $derived(
  selectedGroupChat
    ? new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat.id)))
    : null
);

// ❌ Bad: Query never updates
let messages = new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat?.id ?? 0)));
```

### 2. Check for null Before Accessing .rows

```svelte
<!-- ✅ Good: Handle null queries -->
{#if messages}
  {#each messages.rows as msg}
    <p>{msg.text}</p>
  {/each}
{/if}

<!-- ❌ Bad: Runtime error if messages is null -->
{#each messages.rows as msg}
  <p>{msg.text}</p>
{/each}
```

### 3. Use .events API for Event Handlers

```typescript
// ✅ Good: Flexible, can change handlers dynamically
$effect(() => {
  if (messages) {
    messages.events.onInsert(handleNewMessage);
  }
});

// ❌ Less flexible: Handler is fixed at construction
let messages = new STQuery<DbConnection, Message>('message', undefined, {
  onInsert: handleNewMessage
});
```

### 4. Always Register Events in $effect

```typescript
// ✅ Good: Subscription stays alive
$effect(() => {
  if (messages) {
    messages.events.onInsert((msg) => console.log(msg));
  }
});

// ❌ Bad: Subscription may be cleaned up immediately
if (messages) {
  messages.events.onInsert((msg) => console.log(msg));
}
```

### 5. Use isClient for Identity Comparisons

```typescript
// ✅ Good: Works even before connection established
where(isClient('identity'))

// ❌ Bad: Might be undefined
where(eq('identity', spacetimeContext.connection.identity))
```

### 6. Clean Variable Names

```typescript
// ✅ Good: Clear what the query contains
let currentUserMessages = new STQuery<DbConnection, Message>(...);
let otherUsersInGroupChat = new STQuery<DbConnection, GroupChatMembership>(...);

// ❌ Bad: Unclear what it contains
let query1 = new STQuery<DbConnection, Message>(...);
let data = new STQuery<DbConnection, GroupChatMembership>(...);
```

### 7. Leverage TypeScript

```typescript
// ✅ Good: Full type safety
let messages = new STQuery<DbConnection, Message>('message', where(eq('groupchatId', 123)));

// ❌ Bad: Loses type checking (but still works)
let messages: any = new STQuery('message', where(eq('groupchatId', 123)));
```

---

## Complete Example

Here's a complete example showing all the concepts together:

```svelte
<script lang="ts">
  import { STQuery, where, eq, and, not, or, isClient } from './lib/components/spacetime/svelte_spacetime';
  import { DbConnection, User, GroupChat, GroupChatMembership, Message } from './lib/components/spacetime/module_bindings';
  import { getSpacetimeContext } from './lib/components/spacetime/svelte_spacetime/SpacetimeContext.svelte';

  // Get context for connection state
  let spacetimeContext = getSpacetimeContext<DbConnection>();

  // Static queries (never change)
  let allUsers = new STQuery<DbConnection, User>('user');
  let allGroupChats = new STQuery<DbConnection, GroupChat>('groupchat');

  // Current user query (uses isClient)
  let currentUserQuery = new STQuery<DbConnection, User>('user', where(isClient('identity')));
  let currentUser = $derived(currentUserQuery.rows[0]);

  // User's memberships
  let myMemberships = new STQuery<DbConnection, GroupChatMembership>(
    'groupchatMembership',
    where(isClient('identity'))
  );

  // Selected group chat (reactive state)
  let selectedGroupChat: GroupChat | undefined = $state();

  // Dynamic query - messages for selected group chat
  let groupChatMessages = $derived(
    selectedGroupChat
      ? new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat.id)))
      : null
  );

  // Dynamic query - members of selected group chat (excluding current user)
  let groupChatMembers = $derived(
    selectedGroupChat
      ? new STQuery<DbConnection, GroupChatMembership>(
          'groupchatMembership',
          where(and(
            eq('groupchatId', selectedGroupChat.id),
            not(isClient('identity'))
          ))
        )
      : null
  );

  // Notification system - messages from other group chats
  let notificationMessages = $derived.by(() => {
    if (myMemberships.rows.length === 0) return null;
    
    return new STQuery<DbConnection, Message>(
      'message',
      where(
        or(...myMemberships.rows
          .filter(m => m.groupchatId !== selectedGroupChat?.id)
          .map(m => eq('groupchatId', m.groupchatId))
        )
      )
    );
  });

  // Event handlers for notifications
  $effect(() => {
    if (notificationMessages) {
      notificationMessages.events.onInsert((message) => {
        const sender = allUsers.rows.find(u => u.identity.isEqual(message.sender));
        if (sender) {
          showNotification(`New message from ${sender.name}`);
        }
      });
    }
  });

  // Helper functions
  function showNotification(text: string) {
    // Your notification logic
  }

  function selectGroupChat(chat: GroupChat) {
    selectedGroupChat = chat;
  }
</script>

<!-- Connection status -->
<div class="status">
  {spacetimeContext.connection.isActive ? '🟢 Connected' : '🔴 Disconnected'}
  {#if currentUser}
    <span>Logged in as: {currentUser.name}</span>
  {/if}
</div>

<!-- Group chat list -->
<div class="sidebar">
  <h2>My Group Chats</h2>
  {#each myMemberships.rows as membership}
    {@const chat = allGroupChats.rows.find(c => c.id === membership.groupchatId)}
    {#if chat}
      <button
        onclick={() => selectGroupChat(chat)}
        class:active={selectedGroupChat?.id === chat.id}
      >
        {chat.name}
      </button>
    {/if}
  {/each}
</div>

<!-- Messages -->
<div class="messages">
  {#if groupChatMessages}
    {#each groupChatMessages.rows as message}
      {@const sender = allUsers.rows.find(u => u.identity.isEqual(message.sender))}
      <div class="message">
        <strong>{sender?.name ?? 'Unknown'}:</strong>
        {message.text}
      </div>
    {/each}
  {:else}
    <p>Select a group chat to view messages</p>
  {/if}
</div>

<!-- Members -->
<div class="members">
  <h3>Members</h3>
  {#if groupChatMembers}
    {#each groupChatMembers.rows as membership}
      {@const user = allUsers.rows.find(u => u.identity.isEqual(membership.identity))}
      {#if user}
        <div class="member">{user.name}</div>
      {/if}
    {/each}
  {/if}
</div>
```

---

## Troubleshooting

### Events Not Firing

**Problem:** Event callbacks aren't being called

**Solution:** Make sure you're registering events inside an `$effect`:

```typescript
// ✅ Correct
$effect(() => {
  if (query) {
    query.events.onInsert(handler);
  }
});
```

### Query Not Updating

**Problem:** Query doesn't update when reactive state changes

**Solution:** Use `$derived` to recreate the query:

```typescript
// ✅ Correct
let query = $derived(
  someState ? new STQuery(...) : null
);
```

### Identity is undefined

**Problem:** `spacetimeContext.connection.identity` is `undefined`

**Solution:** Use `isClient()` instead of accessing identity directly:

```typescript
// ✅ Correct
where(isClient('identity'))

// ❌ Wrong
where(eq('identity', spacetimeContext.connection.identity))
```

---

## Summary

- **SpacetimeDBProvider** - Sets up the connection and provides context
- **STQuery** - Type-safe, reactive queries with automatic cleanup
- **$derived** - Use for queries that depend on reactive state
- **isClient()** - Compare against current user's identity safely
- **.events API** - Register event handlers inside `$effect` for proper subscription management
- **WHERE clauses** - Build complex filters with `eq`, `and`, `or`, `not`, and `isClient`

Happy coding! 🚀
