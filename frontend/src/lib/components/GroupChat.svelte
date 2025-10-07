<script lang="ts">
	import { Badge, Button, Card, CardBody, CardHeader, Col, colorMode, Container, Input, InputGroup, InputGroupText, Modal, Row } from "@sveltestrap/sveltestrap";
	import { DbConnectionBuilder, DbConnectionImpl } from "spacetimedb";
	import { createReactiveTable, type ReactiveTable, eq, where } from "./spacetime/svelte_context";
	import { DbConnection, GroupChat, GroupChatMembership, Message, SendMessage, User } from "./spacetime/module_bindings";
	import { getSpacetimeContext } from "./spacetime/SpacetimeContext.svelte";
	import { getContext, onDestroy, untrack } from "svelte";
	import type { AppContext } from "$lib/AppContext.svelte";

    let spacetimeContext = getSpacetimeContext<DbConnection>();
    let groupChatsTable: ReactiveTable<GroupChat> = createReactiveTable<DbConnection, GroupChat>('groupchat');
    let messagesTable: ReactiveTable<Message> | null = $state(null);
    let groupChatMembersTable: ReactiveTable<GroupChatMembership> | null = $state(null);

    let selectedGroupChat: GroupChat | null = $state(null);
    
    const appContext: AppContext = getContext('AppContext');

    $effect(() => {
        if (selectedGroupChat) {
            untrack(() => {messagesTable?.destroy();});
            messagesTable = createReactiveTable<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat.id)));
            groupChatMembersTable = createReactiveTable<DbConnection, GroupChatMembership>('groupchatMembership', where(
                eq('groupchatId', selectedGroupChat.id)
            ));
        }
    })

    let clientMembershipsTable: ReactiveTable<GroupChatMembership> | null = $state(null);
    $effect(() => {
        if (spacetimeContext.connected && spacetimeContext.connection?.identity) {
            clientMembershipsTable = createReactiveTable<DbConnection, GroupChatMembership>('groupchat_membership',
                where(eq('identity', spacetimeContext.connection.identity))
            );
        }
    })

    // Clean up reactive tables when component is destroyed
    onDestroy(() => {
        groupChatsTable.destroy();
        messagesTable?.destroy();
        groupChatMembersTable?.destroy();
        clientMembershipsTable?.destroy();
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
        if (!selectedGroupChat) {
            console.error("No groupchat selected");
            return;
        }
        spacetimeContext.connection.reducers.sendMessage(selectedGroupChat.id, input);
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
                <!-- GROUP CHAT SELECTION -->
                
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
                            <Button outline={selectedGroupChat !== chat} onclick={() => {
                                console.log('GroupChat: Button clicked to select groupchat:', chat.id);
                                selectedGroupChat = chat;
                            }}>
                                {chat.id}
                            </Button>
                        </Row>
                        
                    {/each}
                {:else}
                    <h3>{spacetimeContext.connected ? 'Loading group chats...' : 'Waiting for connection...'}</h3>
                {/if}
            </Col>
            
            <!-- GROUP CHAT -->
            <Col xs="7">
                <!-- HEADER -->
                {#if selectedGroupChat}
                    <h4>Group Chat {selectedGroupChat.id}</h4>
                    {#if clientMembershipsTable?.rows.find(m => m.groupchatId === selectedGroupChat?.id)}
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
                            {/if}
                        {:else}
                            <Card>
                                <CardBody>Loading messages...</CardBody>
                            </Card>
                        {/if}
                    {:else}
                        <Button color="primary" class="mb-2" onclick={() => {
                            if (spacetimeContext.connection && selectedGroupChat) {
                                spacetimeContext.connection.reducers.joinGroupchat(selectedGroupChat.id);
                            }
                        }}>Join Chat</Button>
                    {/if}
                {:else}
                    <h3>Select a group chat!</h3>
                {/if}
            </Col>
            <!-- USERS -->
            <Col xs="3">
                {#if appContext.clientUser}
                    <Card class="border-primary">
                        <CardHeader><h6>{appContext.clientUser.name ? appContext.clientUser.name : appContext.clientUser.identity.toHexString()}</h6></CardHeader>
                    </Card>
                {/if}
                {#if clientMembershipsTable}
                    All Memberships:
                    {#each clientMembershipsTable.rows ?? [] as user}
                        <Card class="my-2">
                            <CardHeader>...{user.identity.toHexString().slice(-6)}</CardHeader>
                            <CardBody>{user.groupchatId}</CardBody>
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