const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

let users = {};
let activeBets = [];
let gameHistory = [];

let countdown = 30;
let currentPeriod = 20260825001;

const colorConfig = {
  0: ['Red', 'Violet'], 1: ['Green'], 2: ['Red'], 3: ['Green'], 4: ['Red'],
  5: ['Green', 'Violet'], 6: ['Red'], 7: ['Green'], 8: ['Red'], 9: ['Green']
};

app.post('/api/signup', (req, res) => {
  const { phone, pass } = req.body;
  if (!phone || !pass || phone.length !== 10) {
    return res.status(400).json({ success: false, message: 'Valid phone and password required.' });
  }
  if (users[phone]) {
    return res.status(400).json({ success: false, message: 'User already exists.' });
  }
  users[phone] = { phone, pass, balance: 1000 };
  res.json({ success: true, user: users[phone] });
});

app.post('/api/login', (req, res) => {
  const { phone, pass } = req.body;
  const user = users[phone];
  if (!user || user.pass !== pass) {
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }
  res.json({ success: true, user });
});

io.on('connection', (socket) => {
  socket.emit('gameState', {
    period: currentPeriod,
    countdown: countdown,
    history: gameHistory.slice(0, 10)
  });

  socket.on('placeBet', (data) => {
    const { phone, type, value, amount } = data;
    const user = users[phone];

    if (!user) return socket.emit('betResponse', { success: false, message: 'User not found.' });
    if (countdown <= 5) return socket.emit('betResponse', { success: false, message: 'Betting locked for this round.' });
    if (amount <= 0 || isNaN(amount)) return socket.emit('betResponse', { success: false, message: 'Invalid amount.' });
    if (user.balance < amount) return socket.emit('betResponse', { success: false, message: 'Insufficient balance.' });

    user.balance -= amount;
    activeBets.push({ phone, type, value, amount, socketId: socket.id });

    socket.emit('betResponse', { success: true, balance: user.balance, message: `Bet locked: ₹${amount} on ${value}` });
  });
});

setInterval(() => {
  countdown--;
  io.emit('timerTick', { countdown });

  if (countdown <= 0) {
    drawResult();
    countdown = 30;
  }
}, 1000);

function drawResult() {
  const winningNumber = Math.floor(Math.random() * 10);
  const winningColors = colorConfig[winningNumber];

  const roundResult = {
    period: currentPeriod,
    number: winningNumber,
    colors: winningColors
  };

  gameHistory.unshift(roundResult);
  if (gameHistory.length > 50) gameHistory.pop();

  activeBets.forEach((bet) => {
    let won = false;
    let profit = 0;
    const user = users[bet.phone];

    if (bet.type === 'number' && Number(bet.value) === winningNumber) {
      won = true;
      profit = bet.amount * 9;
    } else if (bet.type === 'color' && winningColors.includes(bet.value)) {
      won = true;
      profit = winningColors.length > 1 ? bet.amount * 4.5 : bet.amount * 2;
    }

    if (won && user) {
      user.balance += profit;
      io.to(bet.socketId).emit('roundOutcome', {
        won: true,
        profit,
        newBalance: user.balance,
        message: `Won ₹${profit}! Result: ${winningNumber} (${winningColors.join('/')})`
      });
    } else if (user) {
      io.to(bet.socketId).emit('roundOutcome', {
        won: false,
        profit: 0,
        newBalance: user.balance,
        message: `Lost ₹${bet.amount}. Result: ${winningNumber} (${winningColors.join('/')})`
      });
    }
  });

  activeBets = [];

  io.emit('roundFinished', {
    result: roundResult,
    nextPeriod: currentPeriod + 1
  });

  currentPeriod++;
}

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Wingo Server is live on port ${PORT}`);
});
    
