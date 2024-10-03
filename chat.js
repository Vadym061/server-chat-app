import mongoose from 'mongoose';

// Оголошення схеми чату
const chatSchema = new mongoose.Schema({
    firstName: String,
    lastName: String,
    lastMessage: String,
    messages: [{ text: String, isMe: Boolean }]
});

// Створення моделі чату
const Chat = mongoose.model('Chat', chatSchema);

// Експорт моделі як default
export default Chat;