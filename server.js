const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

// Serve static files
app.use(express.static(__dirname));

// ============================================================
// CLASSROOM STATE
// ============================================================
let boardHistory = [];
let isLocked = false;
let currentBg = '';
let currentZoom = 1;
let users = {};
let studentsList = {};
let studentCounter = 0;
let handRaised = {};
let pollData = null;
let pollVotes = {};

// ============================================================
// SOCKET EVENTS
// ============================================================
io.on('connection', (socket) => {
    console.log('🟢 Connected:', socket.id);

    // Send current state to new user
    socket.emit('history-sync', boardHistory);
    socket.emit('bg-sync', currentBg);
    socket.emit('zoom-sync', currentZoom);
    socket.emit('lock-state', isLocked);
    socket.emit('student-list', studentsList);

    // Register role
    socket.on('register-role', (role) => {
        users[socket.id] = { 
            role, 
            name: `Student ${++studentCounter}` 
        };
        console.log(`👤 ${users[socket.id].name} joined as ${role}`);

        if (role === 'student') {
            studentsList[socket.id] = {
                id: socket.id,
                name: users[socket.id].name,
                role: 'student',
                handRaised: false,
                present: false
            };
            io.emit('student-joined', studentsList[socket.id]);
            io.emit('student-list', studentsList);
        }
    });

    // Set name
    socket.on('set-name', (name) => {
        if (users[socket.id]) {
            users[socket.id].name = name;
            if (studentsList[socket.id]) {
                studentsList[socket.id].name = name;
                io.emit('student-list', studentsList);
                io.emit('name-updated', { id: socket.id, name: name });
            }
        }
    });

    // Drawing
    socket.on('drawing', (data) => {
        boardHistory.push(data);
        socket.broadcast.emit('drawing', data);
    });

    // Draw shape
    socket.on('draw-shape', (data) => {
        boardHistory.push(data);
        socket.broadcast.emit('draw-shape', data);
    });

    // Draw text
    socket.on('draw-text', (data) => {
        boardHistory.push(data);
        socket.broadcast.emit('draw-text', data);
    });

    // Clear board
    socket.on('clearBoard', () => {
        boardHistory = [];
        io.emit('clearBoard');
    });

    // Background sync
    socket.on('bg-sync', (imgData) => {
        currentBg = imgData;
        socket.broadcast.emit('bg-sync', imgData);
    });

    // Zoom sync
    socket.on('zoom-sync', (scale) => {
        currentZoom = scale;
        socket.broadcast.emit('zoom-sync', scale);
    });

    // Lock toggle (teacher only)
    socket.on('toggle-lock', (lockState) => {
        if (users[socket.id]?.role === 'teacher') {
            isLocked = lockState;
            io.emit('lock-state', isLocked);
            console.log(`🔒 Board ${isLocked ? 'LOCKED' : 'UNLOCKED'} by teacher`);
        }
    });

    // Hand raise
    socket.on('raise-hand', (data) => {
        if (users[data.id]) {
            handRaised[data.id] = true;
            if (studentsList[data.id]) {
                studentsList[data.id].handRaised = true;
            }
            io.emit('hand-raised', { id: data.id, name: users[data.id].name });
            console.log(`✋ ${users[data.id].name} raised hand`);
        }
    });

    // Lower all hands (teacher only)
    socket.on('lower-all-hands', () => {
        if (users[socket.id]?.role === 'teacher') {
            handRaised = {};
            Object.values(studentsList).forEach(s => s.handRaised = false);
            io.emit('lower-all-hands');
            console.log('👋 All hands lowered by teacher');
        }
    });

    // Mute all (teacher only)
    socket.on('mute-all', () => {
        if (users[socket.id]?.role === 'teacher') {
            io.emit('mute-all');
            console.log('🔇 Teacher muted all students');
        }
    });

    // Reactions
    socket.on('reaction', (data) => {
        const name = users[data.sender]?.name || 'Someone';
        io.emit('reaction', { ...data, name });
    });

    // Math symbols
    socket.on('math-symbol', (data) => {
        socket.broadcast.emit('math-symbol', data);
    });

    // Chat
    socket.on('chat-message', (data) => {
        const name = users[socket.id]?.name || data.name || (data.role === 'teacher' ? 'Teacher' : 'Student');
        const msgData = { ...data, name };
        io.emit('chat-message', msgData);
        console.log(`💬 ${name}: ${data.text}`);
    });

    // Poll
    socket.on('poll-created', (data) => {
        pollData = data;
        pollVotes = {};
        data.options.forEach(opt => pollVotes[opt] = 0);
        io.emit('poll-created', data);
        console.log(`📊 Poll created: ${data.question}`);
    });

    socket.on('poll-vote', (data) => {
        if (pollData && pollVotes[data.option] !== undefined) {
            pollVotes[data.option]++;
            io.emit('poll-vote', data);
            console.log(`📊 Vote for: ${data.option}`);
        }
    });

    // Undo/Redo
    socket.on('undo-draw', () => {
        socket.broadcast.emit('undo-draw');
    });

    socket.on('redo-draw', () => {
        socket.broadcast.emit('redo-draw');
    });

    // WebRTC signaling
    socket.on('signal', (data) => {
        if (data.targetId === 'all') {
            socket.broadcast.emit('signal', { senderId: socket.id, signal: data.signal });
        } else {
            io.to(data.targetId).emit('signal', { senderId: socket.id, signal: data.signal });
        }
    });

    // Disconnect
    socket.on('disconnect', () => {
        console.log('🔴 Disconnected:', socket.id);
        delete studentsList[socket.id];
        delete handRaised[socket.id];
        io.emit('student-list', studentsList);
        io.emit('user-left', socket.id);
        delete users[socket.id];
    });
});

// ============================================================
// SERVER CONFIGURATION
// ============================================================
const PORT = process.env.PORT || 3001;

server.listen(PORT, '0.0.0.0', () => {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║         🎓 A-Class Plus Server Started          ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║   🌐 URL: http://localhost:${PORT}               ║`);
    console.log(`║   📱 Network: http://0.0.0.0:${PORT}            ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║   👨‍🏫 Teacher Password: teacher123               ║');
    console.log('║   👩‍🎓 Student Password: student123               ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║   📊 Features:                                  ║');
    console.log('║   ✅ Whiteboard (Chalk/Pen/Shapes/Text)        ║');
    console.log('║   ✅ Camera (Switch/Resolution/Mirror/BG)      ║');
    console.log('║   ✅ Live Chat with Reactions                  ║');
    console.log('║   ✅ Student Grid with Hand Raise              ║');
    console.log('║   ✅ Polls & Timer                             ║');
    console.log('║   ✅ Breakout Rooms                            ║');
    console.log('║   ✅ Screen Sharing                            ║');
    console.log('║   ✅ Recording with Audio                      ║');
    console.log('║   ✅ Math Tools (Σ, ∫, √, π, etc.)            ║');
    console.log('║   ✅ Undo/Redo & Save Board                   ║');
    console.log('╠══════════════════════════════════════════════════╣');
    console.log(`║   🟢 Server running on port ${PORT}              ║`);
    console.log('╚══════════════════════════════════════════════════╝');
});