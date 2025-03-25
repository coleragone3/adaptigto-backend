require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Clerk } = require('@clerk/clerk-sdk-node');

const app = express();
const port = process.env.PORT || 3001;

// Initialize Clerk
const clerk = new Clerk({ secretKey: process.env.CLERK_SECRET_KEY });

// Visit tracking store
const visits = {
  total: 0,
  today: 0,
  thisWeek: 0,
  lastReset: new Date(),
  dailyVisits: {},
  weeklyVisits: {}
};

// Reset counters daily and weekly
setInterval(() => {
  const now = new Date();
  const dayKey = now.toISOString().split('T')[0];
  const weekKey = `${now.getFullYear()}-W${Math.ceil((now.getDate() + now.getDay()) / 7)}`;
  
  // Reset daily counter at midnight
  if (!visits.dailyVisits[dayKey]) {
    visits.today = 0;
    visits.dailyVisits[dayKey] = 0;
  }
  
  // Reset weekly counter on Sunday midnight
  if (!visits.weeklyVisits[weekKey]) {
    visits.thisWeek = 0;
    visits.weeklyVisits[weekKey] = 0;
  }
}, 1000 * 60);

// Function to record a visit
const recordVisit = () => {
  const now = new Date();
  const dayKey = now.toISOString().split('T')[0];
  const weekKey = `${now.getFullYear()}-W${Math.ceil((now.getDate() + now.getDay()) / 7)}`;
  
  visits.total++;
  visits.today++;
  visits.thisWeek++;
  
  visits.dailyVisits[dayKey] = (visits.dailyVisits[dayKey] || 0) + 1;
  visits.weeklyVisits[weekKey] = (visits.weeklyVisits[weekKey] || 0) + 1;
};

// Endpoint to record a visit
app.post('/api/record-visit', async (req, res) => {
  try {
    recordVisit();
    res.json({ success: true });
  } catch (error) {
    console.error('Error recording visit:', error);
    res.status(500).json({ error: 'Failed to record visit' });
  }
});

// Configure CORS
const allowedOrigins = [
  'http://localhost:3000',
  'https://adaptigto-frontend.vercel.app',
  'https://adaptigto-frontend-git-main-coles-projects-4757d6eb.vercel.app',
  'https://adaptigto-frontend-q1xbgmhbv-coles-projects-4757d6eb.vercel.app',
  'https://adaptigto-frontend-5o0198zjp-coles-projects-4757d6eb.vercel.app',
  'https://adaptigto.vercel.app',
  'https://adaptigto.com'
];

// CORS configuration
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept']
}));

// Handle preflight requests
app.options('*', cors());

app.use(express.json());

// Basic test endpoint
app.get('/', (req, res) => {
  res.json({ message: 'Server is running' });
});

// Middleware to verify Clerk token
const requireAuth = async (req, res, next) => {
  try {
    console.log('=== Auth Debug Start ===');
    console.log('Headers:', req.headers);
    
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      console.log('No token provided in request');
      console.log('=== Auth Debug End ===');
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      console.log('Token found:', token.substring(0, 10) + '...');
      console.log('CLERK_SECRET_KEY exists:', !!process.env.CLERK_SECRET_KEY);
      
      console.log('Attempting to verify token...');
      const decoded = await clerk.verifyToken(token);
      console.log('Token verification result:', {
        success: !!decoded,
        sub: decoded?.sub,
        hasUserId: !!decoded?.sub
      });
      
      if (!decoded || !decoded.sub) {
        console.log('Invalid token structure');
        console.log('=== Auth Debug End ===');
        return res.status(401).json({ error: 'Invalid token structure' });
      }

      // Get the user from Clerk
      console.log('Fetching user with ID:', decoded.sub);
      const user = await clerk.users.getUser(decoded.sub);
      console.log('User found:', !!user);
      
      if (!user) {
        console.log('User not found');
        console.log('=== Auth Debug End ===');
        return res.status(401).json({ error: 'User not found' });
      }

      // Check if user is admin
      const userEmail = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId)?.emailAddress;
      console.log('User email:', userEmail);
      const adminEmails = ['coleragone@gmail.com', 'ben.greenspon@gmail.com', 'ztsakounis@gmail.com'];
      const isAdmin = adminEmails.includes(userEmail);
      console.log('Is admin email:', isAdmin);
      
      if (!isAdmin) {
        console.log('User not authorized');
        console.log('=== Auth Debug End ===');
        return res.status(403).json({ error: 'Not authorized' });
      }

      console.log('User authorized successfully');
      console.log('=== Auth Debug End ===');
      req.userId = decoded.sub;
      next();
    } catch (verifyError) {
      console.error('Token verification failed:', verifyError);
      console.log('=== Auth Debug End ===');
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Auth error:', error);
    console.log('=== Auth Debug End ===');
    res.status(401).json({ error: 'Authentication failed' });
  }
};

// Pre-order endpoint
app.post('/api/pre-order', requireAuth, async (req, res) => {
  try {
    console.log('Pre-order request received for user:', req.userId);
    
    // Get the user from Clerk
    const user = await clerk.users.getUser(req.userId);
    console.log('Found user:', user.id);

    // Check if user has already pre-ordered
    if (user.publicMetadata && user.publicMetadata.hasPreordered) {
      console.log('User has already pre-ordered');
      return res.json({ message: 'Already pre-ordered' });
    }

    // Update user metadata to mark as pre-ordered
    await clerk.users.updateUser(user.id, {
      publicMetadata: {
        ...user.publicMetadata,
        hasPreordered: true,
        preorderDate: new Date().toISOString()
      }
    });
    console.log('Updated user metadata with pre-order status');

    res.json({ message: 'Pre-order recorded successfully' });
  } catch (error) {
    console.error('Pre-order error:', error);
    res.status(500).json({ error: 'Failed to record pre-order' });
  }
});

// Admin users endpoint
app.get('/api/admin/users', requireAuth, async (req, res) => {
  try {
    console.log('Admin request received, fetching users...');
    
    // Verify admin access
    const adminUser = await clerk.users.getUser(req.userId);
    const adminEmails = ['coleragone@gmail.com', 'ben.greenspon@gmail.com', 'ztsakounis@gmail.com'];
    if (!adminEmails.includes(adminUser.emailAddresses[0].emailAddress)) {
      console.log('Unauthorized access attempt');
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    // Fetch all users
    console.log('Fetching user list...');
    const users = await clerk.users.getUserList();
    console.log(`Found ${users.length} users`);

    // Map users to include necessary information
    const mappedUsers = users.map(user => ({
      id: user.id,
      email: user.emailAddresses[0]?.emailAddress,
      firstName: user.firstName,
      lastName: user.lastName,
      lastSignInAt: user.lastSignInAt,
      createdAt: user.createdAt,
      blocked: user.blocked,
      publicMetadata: user.publicMetadata
    }));

    res.json(mappedUsers);
  } catch (error) {
    console.error('Admin endpoint error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Admin visits endpoint
app.get('/api/admin/visits', requireAuth, async (req, res) => {
  try {
    // Verify admin access
    const adminUser = await clerk.users.getUser(req.userId);
    const adminEmails = ['coleragone@gmail.com', 'ben.greenspon@gmail.com', 'ztsakounis@gmail.com'];
    if (!adminEmails.includes(adminUser.emailAddresses[0].emailAddress)) {
      return res.status(403).json({ error: 'Unauthorized access' });
    }

    res.json({
      total: visits.total,
      today: visits.today,
      thisWeek: visits.thisWeek,
      dailyVisits: visits.dailyVisits,
      weeklyVisits: visits.weeklyVisits
    });
  } catch (error) {
    console.error('Error fetching visits:', error);
    res.status(500).json({ error: 'Failed to fetch visit statistics' });
  }
});

// GTO Strategy calculation endpoint
app.post('/calculate-gto-strategy', async (req, res) => {
  try {
    const {
      pot,
      stack,
      position,
      hand,
      board,
      action,
      villainRange,
      villainAction
    } = req.body;

    // Basic validation
    if (!pot || !stack || !position || !hand || !board || !action || !villainRange || !villainAction) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    // Simple GTO calculation logic (can be replaced with more sophisticated algorithm)
    const handStrength = calculateHandStrength(hand);
    const positionValue = getPositionValue(position);
    const villainRangeStrength = getVillainRangeStrength(villainRange);
    const potOdds = pot / (pot + stack);

    // Calculate strategy based on position and hand strength
    let threebet = 0;
    let call = 0;
    let fold = 0;
    let ev = 0;

    if (position === 'BTN' || position === 'CO') {
      if (handStrength > 0.8) {
        threebet = 80;
        call = 15;
        fold = 5;
        ev = 0.85;
      } else if (handStrength > 0.6) {
        threebet = 60;
        call = 25;
        fold = 15;
        ev = 0.65;
      } else {
        threebet = 30;
        call = 20;
        fold = 50;
        ev = 0.35;
      }
    } else if (position === 'SB') {
      if (handStrength > 0.7) {
        threebet = 75;
        call = 20;
        fold = 5;
        ev = 0.80;
      } else {
        threebet = 40;
        call = 30;
        fold = 30;
        ev = 0.45;
      }
    } else if (position === 'BB') {
      if (handStrength > 0.6) {
        threebet = 70;
        call = 25;
        fold = 5;
        ev = 0.75;
      } else {
        threebet = 35;
        call = 40;
        fold = 25;
        ev = 0.50;
      }
    } else {
      // Early position
      if (handStrength > 0.8) {
        threebet = 85;
        call = 10;
        fold = 5;
        ev = 0.90;
      } else if (handStrength > 0.6) {
        threebet = 50;
        call = 20;
        fold = 30;
        ev = 0.55;
      } else {
        threebet = 20;
        call = 15;
        fold = 65;
        ev = 0.25;
      }
    }

    // Generate explanation based on the strategy
    const explanation = generateStrategyExplanation({
      hand,
      position,
      handStrength,
      threebet,
      call,
      fold,
      ev
    });

    res.json({
      threebet,
      call,
      fold,
      ev: ev.toFixed(2),
      explanation
    });
  } catch (error) {
    console.error('GTO calculation error:', error);
    res.status(500).json({ error: 'Failed to calculate GTO strategy' });
  }
});

// Helper functions for GTO calculation
function calculateHandStrength(hand) {
  // Simple hand strength calculation (can be replaced with more sophisticated algorithm)
  const ranks = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
  const rank1 = hand.charAt(0);
  const rank2 = hand.charAt(1);
  const isSuited = hand.endsWith('s');
  
  const rankValue1 = ranks.indexOf(rank1) / ranks.length;
  const rankValue2 = ranks.indexOf(rank2) / ranks.length;
  
  let strength = (rankValue1 + rankValue2) / 2;
  if (isSuited) strength += 0.1;
  if (rank1 === rank2) strength += 0.2;
  
  return Math.min(strength, 1);
}

function getPositionValue(position) {
  const positionValues = {
    'UTG': 0.3,
    'MP': 0.4,
    'CO': 0.6,
    'BTN': 0.8,
    'SB': 0.5,
    'BB': 0.7
  };
  return positionValues[position] || 0.5;
}

function getVillainRangeStrength(range) {
  const rangeStrengths = {
    'UTG': 0.8,
    'MP': 0.7,
    'CO': 0.6,
    'BTN': 0.5,
    'SB': 0.4,
    'BB': 0.3
  };
  return rangeStrengths[range] || 0.5;
}

function generateStrategyExplanation({ hand, position, handStrength, threebet, call, fold, ev }) {
  const strength = handStrength > 0.8 ? 'very strong' :
                   handStrength > 0.6 ? 'strong' :
                   handStrength > 0.4 ? 'moderate' : 'weak';
  
  const positionName = position === 'BTN' ? 'Button' :
                      position === 'CO' ? 'Cutoff' :
                      position === 'SB' ? 'Small Blind' :
                      position === 'BB' ? 'Big Blind' :
                      position;
  
  return `With ${hand} from ${positionName}, we have a ${strength} hand. Our strategy is to three-bet ${threebet}% of the time, call ${call}%, and fold ${fold}%. This balanced approach maximizes our expected value of ${ev} big blinds per hand while maintaining an unexploitable strategy.`;
}

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 