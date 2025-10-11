<script lang="ts">
	import { Badge, Button, Card, CardBody, CardHeader, Col, Container, Input, InputGroup, Modal, Row } from "@sveltestrap/sveltestrap";
	import { STQuery, and, eq, neq, where } from "./spacetime/svelte_context";
	import { DbConnection, GroupChat, GroupChatMembership, Message } from "./spacetime/module_bindings";
	import { getSpacetimeContext } from "./spacetime/SpacetimeContext.svelte";
	import { getContext } from "svelte";
	import type { AppContext } from "$lib/AppContext.svelte";

    const appContext: AppContext = getContext('AppContext');
    const spacetimeContext = getSpacetimeContext<DbConnection>();

    let selectedGroupChat: GroupChat | undefined = $state();
    
    let groupChats = new STQuery<DbConnection, GroupChat>('groupchat');
    let messages = $derived(new STQuery<DbConnection, Message>('message', where(eq('groupchatId', selectedGroupChat?.id))));
    
    let groupChatMemberships = $derived(new STQuery<DbConnection, GroupChatMembership>('groupchat_membership',
        where(and(eq('groupchatId', selectedGroupChat?.id), neq('identity', appContext.clientUser?.identity))))
    );
    let clientMemberships = $derived(new STQuery<DbConnection, GroupChatMembership>('groupchat_membership',
        where(eq('identity', spacetimeContext.identity)))
    );

    let createGroupChatModalOpen = $state(false);
    let createGroupChatName = $state("");
    let changeNameModalOpen = $state(false);
    let newName = $state("");
    let renameGroupChatModalOpen = $state(false);
    let newGroupChatName = $state("");

    let messageInput = $state("");

    const sendMessage = () => {
        if (!spacetimeContext.connection) {
            console.error("No connection available");
            return;
        }
        if (messageInput.trim() === "") {
            return;
        }
        if (!selectedGroupChat) {
            console.error("No groupchat selected");
            return;
        }
        spacetimeContext.connection.reducers.sendMessage(selectedGroupChat.id, messageInput);
        messageInput = ""; // Clear input after sending
    }

    const renameGroupChat = () => {
        if (!spacetimeContext.connection) {
            console.error("No connection available");
            return;
        }
        if (newGroupChatName.trim() === "") {
            return;
        }
        if (!selectedGroupChat) {
            console.error("No groupchat selected");
            return;
        }
        spacetimeContext.connection.reducers.setGroupChatName(selectedGroupChat.id, newGroupChatName);
        newGroupChatName = "";
        renameGroupChatModalOpen = false;
    }

</script>

{#if spacetimeContext.connection}
    <Container fluid>
        <Row class="gx-2 p-3 vh-100">
            <Col xs="2" class="h-100">
                <div class="d-flex flex-column p-1 border rounded h-100">
                    <div class="mb-1 flex-shrink-0">{spacetimeContext.connected ? "🟢 Connected" : "🟡 Connecting"}</div>
                    <!-- GROUP CHAT SELECTION -->
                    {#if groupChats.rows !== undefined}
                        <Button class="mb-3 flex-shrink-0" color="primary" onclick={() => createGroupChatModalOpen = true} disabled={!spacetimeContext.connected}>
                            Create group chat +
                            <Modal body header="Create Group Chat" isOpen={createGroupChatModalOpen} toggle={() => createGroupChatModalOpen = !createGroupChatModalOpen}>
                                <Input placeholder="Group Chat Name" bind:value={createGroupChatName} />
                                <Button class="mt-3" onclick={() => {
                                    if (createGroupChatName.trim() !== "") {
                                        spacetimeContext.connection.reducers.createGroupchat(createGroupChatName);
                                        createGroupChatName = "";
                                        createGroupChatModalOpen = false;
                                    }
                                }}>Create</Button>
                            </Modal>
                        </Button>
                        
                        <h4 class="flex-shrink-0">My Groups:</h4>
                        <div class="flex-grow-1 overflow-auto">
                            {#each groupChats.rows.filter(chat => clientMemberships.rows.some(m => m.groupchatId === chat.id)) as chat}
                                <div class="my-1">
                                    <Button class="w-100" outline={selectedGroupChat !== chat} onclick={() => {selectedGroupChat = chat}}>
                                        {chat.name}
                                    </Button>
                                </div>
                            {:else}
                                <p class="text-muted ms-1 mb-3">Not a member of any groups.</p>
                            {/each}
                        </div>
                        <h4 class="flex-shrink-0">Available Groups:</h4>
                        <div class="flex-grow-1 overflow-auto">
                            {#each groupChats.rows.filter(chat => !clientMemberships.rows.some(m => m.groupchatId === chat.id)) as chat}
                                <div class="my-1">
                                    <Button class="w-100" outline={selectedGroupChat !== chat} onclick={() => {selectedGroupChat = chat}}>
                                        {chat.name}
                                    </Button>
                                </div>
                            {/each}
                        </div>
                    {:else}
                        <h3>{spacetimeContext.connected ? 'Loading group chats...' : 'Waiting for connection...'}</h3>
                    {/if}
                </div>
            </Col>
            <!-- GROUP CHAT -->
            <Col xs="7" class="h-100">
                <div class="d-flex flex-column border rounded p-3 h-100">
                    <!-- HEADER -->
                    {#if selectedGroupChat}
                        <div class="flex-shrink-0">
                            <div class="d-flex align-items-center gap-2">
                                <h4 class="mb-0">Group Chat: {selectedGroupChat.name}</h4>
                                {#if spacetimeContext.identity && selectedGroupChat.createdBy.isEqual(spacetimeContext.identity)}
                                    <Button 
                                        size="sm" 
                                        color="secondary" 
                                        outline
                                        onclick={() => {
                                            if (selectedGroupChat) {
                                                newGroupChatName = selectedGroupChat.name;
                                                renameGroupChatModalOpen = true;
                                            }
                                        }}
                                        title="Rename group chat"
                                    >
                                        ✏️
                                    </Button>
                                    <Modal 
                                        body 
                                        header="Rename Group Chat" 
                                        isOpen={renameGroupChatModalOpen} 
                                        toggle={() => renameGroupChatModalOpen = !renameGroupChatModalOpen}
                                    >
                                        <Input 
                                            placeholder="New Group Chat Name" 
                                            bind:value={newGroupChatName} 
                                            onkeydown={(e) => e.key === 'Enter' && renameGroupChat()}
                                        />
                                        <Button class="mt-3" onclick={renameGroupChat}>Rename</Button>
                                    </Modal>
                                {/if}
                            </div>
                            {#if clientMemberships?.rows.find(m => m.groupchatId === selectedGroupChat?.id)}
                                {#if messages.rows !== undefined}
                                    <div class="chat-header mb-3">
                                        <small>Total: {messages.rows.length ?? '/'} messages</small>
                                    </div>
                                {/if}
                            {/if}
                        </div>
                        {#if clientMemberships?.rows.find(m => m.groupchatId === selectedGroupChat?.id)}
                            {#if messages.rows !== undefined}
                                <!-- MESSAGES AND MESSAGE INPUT -->
                                <div class="d-flex flex-column flex-grow-1" style="min-height: 0;">
                                    <div class="flex-grow-1 overflow-auto mb-3">
                                        {#each messages.rows as message}
                                            <Card class="mb-2">
                                                <CardHeader>{message.sender.toHexString().slice(-6)} <small class="float-left fs-7 text-muted">at {new Date(message.sent.toDate()).toLocaleTimeString()}</small></CardHeader>
                                                <CardBody>{message.text}</CardBody>
                                            </Card>
                                        {/each}
                                    </div>
                                    <div class="flex-shrink-0">
                                        <InputGroup>
                                            <Input placeholder="Type a message..." bind:value={messageInput} onkeydown={(e) => e.key === 'Enter' && sendMessage()} disabled={!spacetimeContext.connected} />
                                            <Button onclick={sendMessage} disabled={!spacetimeContext.connected}>Send</Button>
                                        </InputGroup>
                                    </div>
                                </div>
                            {:else}
                                <Card>
                                    <CardBody>Loading messages...</CardBody>
                                </Card>
                            {/if}
                        {:else}
                            <h5>You are not a member of this group chat.</h5>
                            <Button color="primary" class="mb-2" onclick={() => {
                                if (spacetimeContext.connection && selectedGroupChat) {
                                    spacetimeContext.connection.reducers.joinGroupchat(selectedGroupChat.id);
                                }
                            }}>Join Chat</Button>
                        {/if}
                    {:else}
                        <h3>Select a group chat!</h3>
                    {/if}
                </div>
            </Col>
            <!-- USERS -->
            <Col xs="3" class="h-100">
                <div class="border rounded p-3 h-100">
                    {#if appContext.clientUser}
                    <Card class="border-primary">
                        <CardHeader>
                            <h6>Connected as:</h6>
                            <h6>{appContext.clientUser.name ? appContext.clientUser.name : "..."+appContext.clientUser.identity.toHexString().slice(-10)}</h6>
                            <Button onclick={() => changeNameModalOpen = true} size="sm" color="secondary">Change Name</Button>
                            <Modal body header="Change Display Name" isOpen={changeNameModalOpen} toggle={() => changeNameModalOpen = !changeNameModalOpen}>
                                <Input placeholder="New Display Name" bind:value={newName} />
                                <Button class="mt-3" onclick={() => {
                                    if (newName.trim() !== "") {
                                        spacetimeContext.connection.reducers.setName(newName);
                                        newName = "";
                                        changeNameModalOpen = false;
                                    }
                                }}>Save</Button>
                            </Modal>
                        </CardHeader>
                    </Card>
                    {/if}
                    {#if groupChatMemberships.rows.length > 0}
                        <h6 class="mt-3">Users in this group chat:</h6>
                        {#each groupChatMemberships.rows as membership}
                            <div class="ms-2">
                                {#if appContext.users}
                                    <Badge 
                                        pill={true}
                                        color={['primary', 'danger', 'success', 'warning'][Math.floor(Math.random() * 4)]}
                                        class="me-1">
                                        {appContext.users.rows.find(u => u.identity.toHexString() === membership.identity.toHexString())?.name ?? (membership.identity.toHexString().slice(-6))}
                                    </Badge>
                                {/if}
                            </div>
                        {/each}
                    {/if}
                    <h6 class="mt-3">All Users:</h6>
                    {#if appContext.users}
                        <div class="ms-2">
                            {#each appContext.users.rows ?? [] as user}
                                <Badge 
                                    pill={true}
                                    color={['primary', 'danger', 'success', 'warning'][Math.floor(Math.random() * 4)]}
                                    class="me-1"
                                >
                                    {user.name ?? user.identity.toHexString().slice(-6)}
                                </Badge>
                            {/each}
                        </div>
                    {/if}
                </div>
            </Col>
        </Row>
    </Container>
{:else}
    <p>Connecting to SpacetimeDB...</p>
{/if}