require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Clerk } = require('@clerk/clerk-sdk-node');

const app = express();
const port = process.env.PORT || 3001;

// Initialize Clerk
const clerk = new Clerk({ secretKey: process.env.CLERK_SECRET_KEY });

// Configure CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',') 
  : ['http://localhost:3000'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('Not allowed by CORS'));
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

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
      const decoded = await clerk.verifyToken(token);
      req.userId = decoded.sub;
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

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
}); 