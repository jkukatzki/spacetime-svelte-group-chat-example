<!-- Example usage of reactive SpacetimeDB queries -->
<script lang="ts">
  import { useTable, where, eq, and } from '../util/spacetime/svelte_context/useTable.js';
  import type { DbConnection } from '../util/spacetime/module_bindings';
  
  // Reactive state
  let selectedGameId = $state<number | undefined>(123);
  let showOnlineOnly = $state(true);
  
  // Example 1: Static query (won't change)
  const allPlayersSnapshot = useTable('player');
  
  // Example 2: Reactive query with function - AUTOMATICALLY updates when selectedGameId changes
  const gamePlayersSnapshot = useTable(
    'gameplayer', 
    () => selectedGameId ? where(eq('gameId', selectedGameId)) : undefined,
    {
      onInsert: (player) => console.log('Player joined game:', player),
      onDelete: (player) => console.log('Player left game:', player),
    }
  );
  
  // Example 3: Complex reactive query with multiple conditions
  const filteredPlayersSnapshot = useTable(
    'player',
    () => {
      const conditions = [];
      if (selectedGameId) {
        conditions.push(eq('gameId', selectedGameId));
      }
      if (showOnlineOnly) {
        conditions.push(eq('online', true));
      }
      return conditions.length > 0 ? where(and(...conditions)) : undefined;
    }
  );
  
  // These will automatically update when the reactive dependencies change!
  $: console.log('All players:', allPlayersSnapshot.rows);
  $: console.log('Game players for game', selectedGameId, ':', gamePlayersSnapshot.rows);
  $: console.log('Filtered players:', filteredPlayersSnapshot.rows);
  
  function joinGame(gameId: number) {
    selectedGameId = gameId; // This will automatically update the queries!
  }
  
  function toggleOnlineFilter() {
    showOnlineOnly = !showOnlineOnly; // This will also trigger query updates!
  }
</script>

<div>
  <h2>SpacetimeDB Reactive Queries Example</h2>
  
  <div>
    <label>
      Selected Game ID: 
      <input bind:value={selectedGameId} type="number" />
    </label>
    
    <label>
      <input bind:checked={showOnlineOnly} type="checkbox" />
      Show online players only
    </label>
    
    <button onclick={() => toggleOnlineFilter()}>
      Toggle Online Filter
    </button>
  </div>
  
  <div>
    <h3>All Players ({allPlayersSnapshot.rows.length})</h3>
    <p>Status: {allPlayersSnapshot.state}</p>
  </div>
  
  <div>
    <h3>Players in Game {selectedGameId} ({gamePlayersSnapshot.rows.length})</h3>
    <p>Status: {gamePlayersSnapshot.state}</p>
  </div>
  
  <div>
    <h3>Filtered Players ({filteredPlayersSnapshot.rows.length})</h3>
    <p>Status: {filteredPlayersSnapshot.state}</p>
  </div>
  
  <div>
    <h4>Quick Actions:</h4>
    <button onclick={() => joinGame(1)}>Join Game 1</button>
    <button onclick={() => joinGame(2)}>Join Game 2</button>
    <button onclick={() => joinGame(3)}>Join Game 3</button>
    <button onclick={() => selectedGameId = undefined}>Leave All Games</button>
  </div>
</div>