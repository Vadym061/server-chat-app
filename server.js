import mongoose from 'mongoose';
import fetch from 'node-fetch';
import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws'; 
import dotenv from 'dotenv';
dotenv.config();

// Define Chat schema
const chatSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    lastMessage: String,
    messages: [{ 
        text: String, 
        isMe: Boolean,
        time: { type: Date, default: Date.now }
    }]
});

const Chat = mongoose.model('Chat', chatSchema);

// Define Message schema
const messageSchema = new mongoose.Schema({
    chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat' },
    messageText: String,
    createdAt: { type: Date, default: Date.now }
});

const Message = mongoose.model('Message', messageSchema);

// Initialize Express app
const app = express();
app.use(cors());
app.use(express.json());

app.get('/', (req, res) => {
    res.send('Welcome to the Chat API!');
});

// Initialize WebSocket Server
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        console.log('received: %s', message);
    });
});

const server = app.listen(5000, () => {
    console.log(`Server running on port 5000`);
});

// Upgrade HTTP server to handle WebSocket connections
server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

// Initialize chats
async function initializeChats() {
    const existingChats = await Chat.find();
    if (existingChats.length === 0) {
        await Chat.create([
            {
                firstName: "Alice",
                lastName: "Freeman",
                lastMessage: "How was your meeting?",
                messages: [
                    { text: "Hi, how are you?", isMe: false },
                    { text: "Not bad. What about you?", isMe: true },
                    { text: "How was your meeting?", isMe: true }
                ]
            },
            {
                firstName: "Bob",
                lastName: "Johnson",
                lastMessage: "Was machen Sie?",
                messages: [
                    { text: "Hallo, wie geht es dir?", isMe: false },
                    { text: "Sehr gud. Danke. Und dir?", isMe: true },
                    { text: "Was machen Sie?", isMe: true }
                ]
            },
            {
                firstName: "Cathy",
                lastName: "Smith",
                lastMessage: "Чим ти на вихідних займаєшься?",
                messages: [
                    { text: "Привіт, як справи?", isMe: false },
                    { text: "В мене все добре. А твої як?", isMe: true },
                    { text: "Чим ти на вихідних займаєшься?", isMe: true }
                ]
            }
        ]);
        console.log('Initial chats created.');
    } else {
        console.log('Initial chats already exist.');
    }
}

// Connect to MongoDB
mongoose.connect(process.env.DATABASE_URL)
    .then(() => {
        console.log('Connected to MongoDB');
        initializeChats();
    })
    .catch(err => console.error('Error connecting to MongoDB...', err));

let randomMessageInterval;

const sendRandomMessage = async () => {
    try {
        const chats = await Chat.find();
        if (chats.length === 0) return;

        const randomChat = chats[Math.floor(Math.random() * chats.length)];
        const randomMessage = { text: 'Random message!', isMe: false };

        randomChat.messages.push(randomMessage);
        randomChat.lastMessage = randomMessage.text;
        await randomChat.save();

        // Notify all connected WebSocket clients
        wss.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ chatId: randomChat._id, message: randomMessage }));
            }
        });
    } catch (error) {
        console.error('Error sending random message:', error);
    }
};

// Route to start random messages
app.post('/api/start-random-messages', (req, res) => {
    if (!randomMessageInterval) {
        randomMessageInterval = setInterval(sendRandomMessage, 5000);
        res.json({ message: 'Random message sending enabled' });
    } else {
        res.json({ message: 'Random message sending already enabled' });
    }
});

// Route to stop random messages
app.post('/api/stop-random-messages', (req, res) => {
    if (randomMessageInterval) {
        clearInterval(randomMessageInterval);
        randomMessageInterval = null;
        res.json({ message: 'Random message sending disabled' });
    } else {
        res.json({ message: 'Random message sending already disabled' });
    }
});

// Route to create a new chat
app.post('/api/chats', async (req, res) => {
    try {
        const { firstName, lastName, messages } = req.body;
        if (!firstName || !lastName) {
            return res.status(400).json({ message: 'First name and last name are required' });
        }

        const lastMessage = messages && messages.length > 0 ? messages[messages.length - 1].text : '';
        const newChat = new Chat({ firstName, lastName, messages, lastMessage });
        await newChat.save();

        res.status(201).json(newChat);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to get all chats
app.get('/api/chats', async (req, res) => {
    try {
        const chats = await Chat.find();
        res.json(chats);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to add a message to a chat
app.patch('/api/chats/:id/messages', async (req, res) => {
    try {
        const chat = await Chat.findById(req.params.id);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        chat.messages.push(req.body);
        chat.lastMessage = req.body.text;
        await chat.save();

        res.json(chat);

        // Auto-reply after 3 seconds
        setTimeout(async () => {
            const autoReply = `${req.body.text}`;
            chat.messages.push({ text: autoReply, isMe: false });
            chat.lastMessage = autoReply;
            await chat.save();

            // Notify all connected WebSocket clients about the new message
            wss.clients.forEach(client => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({ chatId: req.params.id, message: { text: autoReply, isMe: false } }));
                }
            });
        }, 3000);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to update a chat's details
app.patch('/api/chats/:id', async (req, res) => {
    try {
        const { firstName, lastName } = req.body;
        if (!firstName || !lastName) {
            return res.status(400).json({ message: 'First name and last name are required' });
        }

        const updatedChat = await Chat.findByIdAndUpdate(req.params.id, { firstName, lastName }, { new: true });
        if (!updatedChat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        res.json(updatedChat);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to delete a chat
app.delete('/api/chats/:id', async (req, res) => {
    try {
        const deletedChat = await Chat.findByIdAndDelete(req.params.id);
        if (!deletedChat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        res.json({ message: 'Chat deleted' });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// Route to update a message in a chat
app.patch('/api/chats/:chatId/messages/:messageId', async (req, res) => {
    try {
        const chat = await Chat.findById(req.params.chatId);
        if (!chat) {
            return res.status(404).json({ message: 'Chat not found' });
        }

        const message = chat.messages.id(req.params.messageId);
        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        message.text = req.body.text;
        await chat.save();

        res.json(chat);
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});