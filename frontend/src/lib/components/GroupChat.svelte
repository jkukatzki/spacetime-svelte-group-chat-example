<script lang="ts">
	import { Badge, Button, Card, CardBody, CardHeader, Col, colorMode, Container, Input, InputGroup, InputGroupText, Modal, Row } from "@sveltestrap/sveltestrap";
	import { DbConnectionBuilder, DbConnectionImpl } from "spacetimedb";
	import { createReactiveTable, type ReactiveTable } from "./spacetime/svelte_context/getReactiveTable.svelte";
	import { DbConnection, GroupChat, Message, SendMessage, User } from "./spacetime/module_bindings";
	import { getSpacetimeContext } from "./spacetime/SpacetimeContext.svelte";
	import { getContext, onDestroy } from "svelte";
	import { eq, neq, and, where } from "./spacetime/svelte_context/QueryFormatting";
	import type { AppContext } from "$lib/AppContext.svelte";

    let spacetimeContext = getSpacetimeContext<DbConnection>();
    let groupChatsTable: ReactiveTable<GroupChat> = createReactiveTable<GroupChat>('groupchat');
    let messagesTable: ReactiveTable<Message> | null = $state(null);
    let groupChatMembersTable: ReactiveTable<User> | null = $state(null);

    const appContext: AppContext = getContext('AppContext');

    $effect(() => {
        if (appContext.clientUser?.groupchatId && spacetimeContext.connection?.identity) {
            messagesTable = createReactiveTable<Message>('message', where(eq('groupchatId', appContext.clientUser.groupchatId)));
            groupChatMembersTable = createReactiveTable<User>('user', where(
                and(
                    eq('groupchatId', appContext.clientUser.groupchatId),
                    neq('identity', spacetimeContext.connection.identity.toHexString())
                )
            ));
        }
    })
    
    // Clean up reactive tables when component is destroyed
    onDestroy(() => {
        groupChatsTable.destroy();
        messagesTable?.destroy();
    });

    let createGroupChatModalOpen = $state(false);
    let createGroupChatName = $state("");
    

    let input = $state("");

    const sendMessage = () => {
        if (!spacetimeContext.connection) {
            console.error("No connection available");
            return;
        }
        if (input.trim() === "") {
            return;
        }
        spacetimeContext.connection.reducers.sendMessage(input);
        input = ""; // Clear input after sending
    }

</script>

{#if spacetimeContext.connection}
    <Container>
        <!-- Connection Status Bar -->
        <div class="connection-status {spacetimeContext.connected ? 'ready' : 'connecting'}">
            {#if spacetimeContext.connected}
                🟢 Connected to SpacetimeDB {spacetimeContext.connection.identity?.toHexString()}
            {:else}
                🟡 Connecting to SpacetimeDB...
            {/if}
        </div>
        
        <Row class="mt-4">
            <Col xs="2">
                <!-- GROUP CHATS -->
                
                {#if spacetimeContext.connected && groupChatsTable.rows !== undefined}
                    <Button onclick={() => createGroupChatModalOpen = true} disabled={!spacetimeContext.connected}>New Chat +</Button>
                    <Modal body header="Create Group Chat" isOpen={createGroupChatModalOpen} toggle={() => createGroupChatModalOpen = !createGroupChatModalOpen}>
                        <Input placeholder="Group Chat Name" bind:value={createGroupChatName} />
                        <Button onclick={() => {
                            if (spacetimeContext.connection && createGroupChatName.trim() !== "" && spacetimeContext.connected) {
                                spacetimeContext.connection.reducers.createGroupchat(createGroupChatName);
                                createGroupChatName = "";
                                createGroupChatModalOpen = false;
                            }
                        }}>Create</Button>
                    </Modal>
                    {#each groupChatsTable.rows as chat}
                        <Row class="my-2">
                            <Button onclick={() => spacetimeContext.connection?.reducers.joinGroupchat(chat.id)}>
                                {chat.id}
                            </Button>
                        </Row>
                        
                    {/each}
                {:else}
                    <h3>{spacetimeContext.connected ? 'Loading group chats...' : 'Waiting for connection...'}</h3>
                {/if}
            </Col>
            <!-- MESSAGES -->
             
            <Col xs="7">
                {#if messagesTable}
                    <div class="chat-header">
                        <h5>Messages ({messagesTable.state === 'ready' ? 'Connected' : 'Loading...'})</h5>
                        <small>Total: {messagesTable.rows?.length ?? '/'} messages</small>
                    </div>
                    {#if messagesTable.rows !== undefined}
                        {#each messagesTable.rows as message}
                            <Card class="mb-2">
                                <CardHeader>{message.sender}:</CardHeader>
                                <CardBody>{message.text}</CardBody>
                            </Card>
                        {/each}
                    {:else}
                        <Card>
                            <CardBody>Loading messages...</CardBody>
                        </Card>
                    {/if}
                {/if}
            </Col>
            <!-- USERS -->
            <Col xs="3">
                {#if appContext.clientUser}
                    <Card class="border-primary">
                        <CardHeader><h6>{appContext.clientUser.name ? appContext.clientUser.name : appContext.clientUser.identity.toHexString()}</h6></CardHeader>
                        <CardBody>Groupchat: {appContext.clientUser.groupchatId}</CardBody>
                    </Card>
                {/if}
                {#if groupChatMembersTable}
                    {#each groupChatMembersTable.rows ?? [] as user}
                        <Card class="my-2">
                            <CardHeader>{user.name ? user.name : user.identity.toHexString()}</CardHeader>
                            <CardBody>In Groupchat: {user.groupchatId}</CardBody>
                        </Card>
                    {/each}
                {/if}
                {#if appContext.users}
                    {#each appContext.users.rows ?? [] as user}
                        <Badge pill={true} color={['primary', 'danger', 'success', 'warning'][Math.floor(Math.random() * 4)]} class="me-1" style="padding-left: 0.2em; max-width: 1em;">{user.name ? user.name[0] : user.identity.toHexString().at(-1)}</Badge>
                    {/each}
                {/if}
                </Col>
        </Row>
    </Container>

    <InputGroup class="fixed-bottom w-50 mx-auto">
        <Input placeholder="Type a message..." bind:value={input} onkeydown={(e) => e.key === 'Enter' && sendMessage()} disabled={!spacetimeContext.connected} />
        <Button onclick={sendMessage} disabled={!spacetimeContext.connected}>Send</Button>
    </InputGroup>
{:else}
    <p>Connecting to SpacetimeDB...</p>
{/if}