# Type-Safe Reactive Tables

## Overview

The `createReactiveTable` function now provides **automatic type safety** based on your SpacetimeDB schema with **compile-time error checking**! 

**✨ Package-Friendly Design** - No imports from generated code! The function extracts type information from your `DbConnection` type parameter, making it perfect for use in a reusable package.

### What does "Compile-Time" mean?

**Compile-time errors** appear in three places:
1. **In your IDE/editor** - Red squiggly lines appear immediately as you type
2. **When running TypeScript compiler** (`tsc` or `npm run build`) - Build fails with clear errors  
3. **During development** (`npm run dev` with Vite) - Type checking happens and shows errors in the terminal

You'll see errors **before** the app runs, not at runtime!

## How It Works

The implementation uses TypeScript utility types to automatically extract type information from your `DbConnection`:

1. **Extracts `RemoteTables`** from the `DbConnection.db` property
2. **Extracts table names** from the `RemoteTables` keys
3. **Extracts row types** by analyzing each table handle's `iter()` return type
4. **Filters valid tables** - only includes tables that resolve to proper types

This means:
- ✅ **No imports from generated code** - works in packages!
- ✅ **No manual maintenance** - types update when you regenerate bindings
- ✅ **Full type safety** - catches typos and provides autocomplete

## Key Types

```typescript
// Extracted from RemoteTables automatically
export type TableName = keyof RemoteTables;
// Result: 'groupchat' | 'groupchatMembership' | 'message' | 'user'

// Maps table names to their row types
export type TableMap = {
  [K in TableName]: ExtractRowType<RemoteTables[K]>
};
// Result: {
//   groupchat: GroupChat;
//   groupchatMembership: GroupChatMembership;
//   message: Message;
//   user: User;
// }
```

## Benefits

### ✅ Works in packages (no generated code imports!)
```typescript
// The function doesn't import RemoteTables or any generated types
// It extracts everything from the DbConnection type parameter
// Perfect for publishing as an npm package!
```

### ✅ Autocomplete for table names
```typescript
createReactiveTable<DbConnection, 'm...'>  // IDE suggests: 'message', etc.
```

### ✅ Immediate TypeScript errors for typos
```typescript
const invalid = createReactiveTable<DbConnection, 'groupcat'>('groupcat');  // Typo!
// ERROR: Type '"groupcat"' does not satisfy the constraint 'ExtractValidTableNames<RemoteTables>'.
// ❌ Build will fail
// ❌ IDE shows red squiggly line
// ❌ Dev server shows the error

const valid = createReactiveTable<DbConnection, 'groupchat'>('groupchat');  // ✅ No error!
```

### ✅ Automatic row type inference
```typescript
const msgs = createReactiveTable<DbConnection, 'message'>('message');
// msgs is ReactiveTable<Message> - Message type inferred from DbConnection!

// Hover over variable in your IDE to see the inferred type!
```

### ✅ Type-safe where clauses
```typescript
const msgs = createReactiveTable('message', where(
  eq('groupchatId', 123)  // 'groupchatId' is validated against Message fields
));
```

### ✅ No manual maintenance
When you add/remove tables from your Rust schema and regenerate bindings, the types update automatically!

## Usage Examples

### Basic table subscription
```typescript
import type { DbConnection } from './spacetime/module_bindings';

const groupChats = createReactiveTable<DbConnection, 'groupchat'>('groupchat');
// Type: ReactiveTable<GroupChat> - fully inferred!
```

### With where clause
```typescript
const filteredMessages = createReactiveTable<DbConnection, 'message'>(
  'message', 
  where(eq('groupchatId', chatId))
);
// Type: ReactiveTable<Message>
```

### With callbacks
```typescript
const users = createReactiveTable<DbConnection, 'user'>('user', {
  onInsert: (user) => console.log('New user:', user),  // user: User (inferred!)
  onDelete: (user) => console.log('User left:', user),
});
```

### With both where clause and callbacks
```typescript
const members = createReactiveTable<DbConnection, 'groupchatMembership'>(
  'groupchatMembership',
  where(eq('groupchatId', chatId)),
  {
    onInsert: (member) => console.log('Member joined:', member),
  }
);
```

## Type Parameters

The function takes two type parameters:
- `TDbConnection` - Your generated DbConnection type (e.g., `DbConnection`)
- `TTableName` - The table name as a string literal (e.g., `'user'`, `'message'`)

TypeScript validates that `TTableName` is a valid table in your schema!

## Implementation Details

Located in: `frontend/src/lib/components/spacetime/svelte_context/createReactiveTable.svelte.ts`

The magic happens through TypeScript's type system:
- **Function overloads** provide different signatures for type inference
- **Mapped types** extract table info from the generated `RemoteTables` class
- **Conditional types** extract row types from table handles

No runtime overhead - it's all compile-time type checking!
