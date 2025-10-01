<script lang="ts">
    import GroupChat from "$lib/components/GroupChat.svelte";
    import SpacetimeDBProvider from "$lib/components/spacetime/svelte_context/SpacetimeDBProvider.svelte";
    import { DbConnection, User } from "$lib/components/spacetime/module_bindings/index"
	import { Styles } from "@sveltestrap/sveltestrap";
	import { onDestroy, setContext } from "svelte";
	import { getSpacetimeContext } from "$lib/components/spacetime/SpacetimeContext.svelte";
	import { createReactiveTable, type ReactiveTable } from "$lib/components/spacetime/svelte_context/getReactiveTable.svelte";
	import { AppContext } from "$lib/AppContext.svelte";

    const spacetimeContext = getSpacetimeContext<DbConnection>();

    

    const appContext = new AppContext();

    setContext('AppContext', appContext);

    let usersTable: ReactiveTable<User> = createReactiveTable<User>('user', {
        onInsert: (user) => {
            if (spacetimeContext.connection?.identity && user.identity.isEqual(spacetimeContext.connection.identity)) {
                appContext.clientUser = user;
            }
        },
        onUpdate: (oldUser, newUser) => { 
            if (spacetimeContext.connection?.identity && newUser.identity.isEqual(spacetimeContext.connection.identity)) {
                appContext.clientUser = newUser;
            }
        }
    },
    );

    onDestroy(() => {
        usersTable.destroy();
    });
    
</script>

<Styles/>
<GroupChat/>