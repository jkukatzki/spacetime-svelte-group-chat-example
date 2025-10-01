<script lang="ts">
	import { Button, Card, CardBody, CardHeader, Col, Container, Input, InputGroup, InputGroupText, Modal, Row } from "@sveltestrap/sveltestrap";
	import { DbConnectionBuilder, DbConnectionImpl } from "spacetimedb";
	import { createReactiveTable, type ReactiveTable } from "./spacetime/svelte_context/getReactiveTable.svelte";
	import { DbConnection, GroupChat, Message, SendMessage, User } from "./spacetime/module_bindings";
	import { getSpacetimeContext } from "./spacetime/SpacetimeContext.svelte";
	import { onDestroy } from "svelte";
	import { eq, where } from "./spacetime/svelte_context/QueryFormatting";

    let spacetimeContext = getSpacetimeContext<DbConnection>();

    let clientUser: User | null = $state(null);
    let groupChatsTable: ReactiveTable<GroupChat> = createReactiveTable<GroupChat>('groupchat');
    let messagesTable: ReactiveTable<Message> | null = $state(null);

    let usersTable: ReactiveTable<User> = createReactiveTable<User>('user', {
        onInsert: (user) => {
            if (spacetimeContext.connection?.identity && user.identity.isEqual(spacetimeContext.connection.identity)) {
                clientUser = user;
            }
        },
        onUpdate: (oldUser, newUser) => { 
            if (spacetimeContext.connection?.identity && newUser.identity.isEqual(spacetimeContext.connection.identity)) {
                clientUser = newUser;
            }
        }
    },
    );

    $effect(() => {
        if (clientUser?.groupchatId) {
            messagesTable = createReactiveTable<Message>('message', where(eq('groupchatId', clientUser.groupchatId)));
        }
    })
    
    // Clean up reactive tables when component is destroyed
    onDestroy(() => {
        groupChatsTable.destroy();
        messagesTable?.destroy();
        usersTable.destroy();
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
                        <small>Total: {messagesTable.rows?.length ?? 0} messages</small>
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
                {#if clientUser}
                    <Card>
                        <CardHeader>{clientUser.name ? clientUser.name : clientUser.identity.toHexString()}</CardHeader>
                        <CardBody>Groupchat: {clientUser.groupchatId}</CardBody>
                    </Card>
                {/if}
                {#each usersTable.rows ? usersTable.rows : [] as user}
                    <Row class="my-2">
                        <Card>
                            <CardBody>
                                {user.name} {user.identity === spacetimeContext.connection?.identity ? '(You)' : ''}
                            </CardBody>
                        </Card>
                    </Row>
                {/each}
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