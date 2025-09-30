<script lang="ts">
  import { createReactiveTable, eq, where } from './getReactiveTable.svelte.js';
  import type { Message } from '../module_bindings/message_type.js';
  import type { User } from '../module_bindings/user_type.js';
  
  // Example 1: Basic usage without filtering
  const allMessages = createReactiveTable<Message>('message', {
    onInsert: (row) => console.log('New message inserted:', row),
    onUpdate: (oldRow, newRow) => console.log('Message updated:', oldRow, newRow),
    onDelete: (row) => console.log('Message deleted:', row)
  });
  
  // Example 2: With filtering by user
  let selectedUserId = $state('user1');
  
  // Create a reactive where clause that updates when selectedUserId changes
  const userMessages = createReactiveTable<Message>('message', {
    onInsert: (row) => console.log('New message from user:', row),
    onDelete: (row) => console.log('Message from user deleted:', row)
  });
  
  // Update the filter reactively when selectedUserId changes
  $effect(() => {
    userMessages.setWhereClause(where(eq('sender', selectedUserId)));
  });
  
  // Example 3: Users table
  const allUsers = createReactiveTable<User>('user', {
    onInsert: (user) => console.log('New user joined:', user.name),
    onDelete: (user) => console.log('User left:', user.name)
  });
  
  // Clean up when component is destroyed
  import { onDestroy } from 'svelte';
  onDestroy(() => {
    allMessages.destroy();
    userMessages.destroy();
    allUsers.destroy();
  });
</script>

<div class="reactive-table-example">
  <h2>Reactive Table Example</h2>
  
  <div class="section">
    <h3>All Messages (State: {allMessages.state})</h3>
    <div class="count">Total messages: {allMessages.rows?.length ?? 0}</div>
    {#if allMessages.rows}
      <ul>
        {#each allMessages.rows as message}
          <li>
            <strong>User {message.sender}:</strong> {message.text}
            <small>(Sent: {new Date(message.sent.toDate()).toLocaleString()})</small>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  
  <div class="section">
    <h3>Filter by User</h3>
    <label>
      User ID: 
      <input type="text" bind:value={selectedUserId} placeholder="Enter user identity" />
    </label>
    
    <h4>Messages from User {selectedUserId} (State: {userMessages.state})</h4>
    <div class="count">Filtered messages: {userMessages.rows?.length ?? 0}</div>
    {#if userMessages.rows}
      <ul>
        {#each userMessages.rows as message}
          <li>
            {message.text}
            <small>(Sent: {new Date(message.sent.toDate()).toLocaleString()})</small>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
  
  <div class="section">
    <h3>All Users (State: {allUsers.state})</h3>
    <div class="count">Total users: {allUsers.rows?.length ?? 0}</div>
    {#if allUsers.rows}
      <ul>
        {#each allUsers.rows as user}
          <li>
            <strong>{user.name}</strong> (ID: {user.identity})
            {#if user.online}
              <span class="online">• Online</span>
            {:else}
              <span class="offline">• Offline</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .reactive-table-example {
    padding: 1rem;
    max-width: 800px;
  }
  
  .section {
    margin-bottom: 2rem;
    padding: 1rem;
    border: 1px solid #ddd;
    border-radius: 4px;
  }
  
  .count {
    font-weight: bold;
    color: #666;
    margin-bottom: 0.5rem;
  }
  
  ul {
    list-style-type: none;
    padding: 0;
  }
  
  li {
    padding: 0.5rem;
    margin: 0.25rem 0;
    background-color: #f5f5f5;
    border-radius: 4px;
  }
  
  small {
    color: #666;
    margin-left: 0.5rem;
  }
  
  .online {
    color: green;
  }
  
  .offline {
    color: #999;
  }
  
  label {
    display: block;
    margin-bottom: 1rem;
  }
  
  input {
    padding: 0.25rem;
    margin-left: 0.5rem;
    border: 1px solid #ccc;
    border-radius: 4px;
  }
</style>