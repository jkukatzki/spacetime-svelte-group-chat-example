React hooks for SpacetimeDB are now here! Using SpacetimeDB with React is now much much easier. Just add a SpacetimeDBProvider to your component hierarchy and use the useTable React hook!

// main.tsx
const connectionBuilder = DbConnection.builder()
  .withUri('wss://maincloud.spacetimedb.com')
  .withModuleName('MODULE_NAME');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </React.StrictMode>
);

// App.tsx
function App() {
  const conn = useSpacetimeDB<DbConnection>();
  const { rows: messages } = useTable<DbConnection, Message>('message');

  ...
}

SpacetimeDB will magically synchronize your table state with your React client and re-render your UI as it changes. About as simple as it gets!

For added power, add a typed where clause to your useTable hook to filter the rows you want to subscribe to:

const { rows: users } = useTable<DbConnection, User>('user', where(eq('online', true)));


 if (spacetimeService.player?.gameId != undefined && initializedGame != spacetimeService.player?.gameId) {
      untrack(() => {
        console.log('App.svelte game  id:', spacetimeService.player?.gameId);
        if (spacetimeService.connectedGameSubscription) {
          spacetimeService.connectedGame = undefined;
          spacetimeService.connectedGameSubscription.unsubscribe();
        }

        if (spacetimeService.gamePlayerSubscription) {
          spacetimeService.gamePlayers = [];
          spacetimeService.gamePlayerSubscription.unsubscribe();
        }
        if (spacetimeService.gameEntitiesSubscription) {
          spacetimeService.gameEntities = [];
          spacetimeService.gameEntitiesSubscription.unsubscribe();
        }

        if (spacetimeService.miniGameListSubscription) {
          spacetimeService.miniGames = [];
          spacetimeService.miniGameListSubscription.unsubscribe();
        }

        if (spacetimeService.gameMessageSubscription) {
          spacetimeService.gameMessages = [];
          spacetimeService.gameMessageSubscription.unsubscribe();
        }
        console.log('XXXXX', 'SELECT * FROM gameplayer WHERE game_id = ' + spacetimeService.player?.gameId);
        spacetimeService.connectedGameSubscription = spacetimeService.conn?.subscriptionBuilder().subscribe('SELECT * FROM game WHERE id = ' + spacetimeService.player?.gameId);
        spacetimeService.gamePlayerSubscription = spacetimeService.conn?.subscriptionBuilder().subscribe('SELECT * FROM gameplayer WHERE game_id = ' + spacetimeService.player?.gameId);
        spacetimeService.gameEntitiesSubscription = spacetimeService.conn?.subscriptionBuilder().subscribe('SELECT * FROM entity WHERE game_id = ' + spacetimeService.player?.gameId);
        spacetimeService.miniGameListSubscription = spacetimeService.conn?.subscriptionBuilder().subscribe('SELECT * FROM minigame WHERE game_id = ' + spacetimeService.player?.gameId);
        spacetimeService.gameMessageSubscription = spacetimeService.conn?.subscriptionBuilder().subscribe('SELECT * FROM gamemessage WHERE game_id = ' + spacetimeService.player?.gameId);
        initializedGame = spacetimeService.player?.gameId;
      });
    } else if (spacetimeService.player?.gameId == undefined && initializedGame != undefined) {
      untrack(() => {
        if (spacetimeService.connectedGameSubscription) {
          spacetimeService.connectedGameSubscription.unsubscribe();
          spacetimeService.connectedGameSubscription = undefined;
        }
        if (spacetimeService.gamePlayerSubscription) {
          spacetimeService.gamePlayerSubscription.unsubscribe();
          spacetimeService.gamePlayerSubscription = undefined;
        }
        if (spacetimeService.gameEntitiesSubscription) {
          spacetimeService.gameEntitiesSubscription.unsubscribe();
          spacetimeService.gameEntitiesSubscription = undefined;
        }
        if (spacetimeService.miniGameListSubscription) {
          spacetimeService.miniGameListSubscription.unsubscribe();
          spacetimeService.miniGameListSubscription = undefined;
        }
        if (spacetimeService.gameMessageSubscription) {
          spacetimeService.gameMessageSubscription.unsubscribe();
          spacetimeService.gameMessageSubscription = undefined;
        }
        spacetimeService.connectedGame = undefined;
        spacetimeService.miniGames = [];
        spacetimeService.gamePlayers = [];
        spacetimeService.gameEntities = [];
        spacetimeService.gameMessages = [];
      })
    }