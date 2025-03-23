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
}, 1000 * 60); // Check every minute

// Middleware to track visits
app.use((req, res, next) => {
  // Only count page views, not API calls
  if (!req.path.startsWith('/api/')) {
    const now = new Date();
    const dayKey = now.toISOString().split('T')[0];
    const weekKey = `${now.getFullYear()}-W${Math.ceil((now.getDate() + now.getDay()) / 7)}`;
    
    visits.total++;
    visits.today++;
    visits.thisWeek++;
    
    visits.dailyVisits[dayKey] = (visits.dailyVisits[dayKey] || 0) + 1;
    visits.weeklyVisits[weekKey] = (visits.weeklyVisits[weekKey] || 0) + 1;
  }
  next();
});

// Configure CORS
const allowedOrigins = [
  'http://localhost:3000',
  'https://adaptigto-frontend.vercel.app',
  'https://adaptigto-frontend-git-main-coles-projects-4757d6eb.vercel.app',
  'https://adaptigto-frontend-q1xbgmhbv-coles-projects-4757d6eb.vercel.app',
  'https://adaptigto-frontend-5o0198zjp-coles-projects-4757d6eb.vercel.app'
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
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }

    try {
      // Verify the JWT token
      const clientToken = await clerk.verifyToken(token);
      
      if (!clientToken || !clientToken.sub) {
        return res.status(401).json({ error: 'Invalid token' });
      }

      // Get the user from Clerk
      const user = await clerk.users.getUser(clientToken.sub);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }

      // Check if user is admin
      if (user.primaryEmailAddress.emailAddress !== 'coleragone@gmail.com') {
        return res.status(403).json({ error: 'Not authorized' });
      }

      req.userId = clientToken.sub;
      next();
    } catch (verifyError) {
      console.error('Token verification failed:', verifyError);
      return res.status(401).json({ error: 'Invalid token' });
    }
  } catch (error) {
    console.error('Auth error:', error);
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
    if (adminUser.emailAddresses[0].emailAddress !== 'coleragone@gmail.com') {
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
    if (adminUser.emailAddresses[0].emailAddress !== 'coleragone@gmail.com') {
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

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 